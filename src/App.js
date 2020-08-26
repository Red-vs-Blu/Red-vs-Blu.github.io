/*
 *  Entry-point for the RedVsBlue application.
 */

// React and associated components.
import React, { Component } from "react";

// Ethereum contract ABI and Web3 loader.
import LoadWeb3  from "./contract/loadWeb3";
import RedVsBlueABI from "./contract/RedVsBlueABI.json";

import "./App.css";

////////////////////////////////////////////////////////////////////////////////

class App extends Component {
    // App constructor - sets up default state.
    constructor(props) {
        super(props);

        /*
         *  Input element `tx_amount` is the amount to buy / withdraw / vote.
         *  This handler just makes sure that the state copy is updated.
         */
        this.txAmountChanged = this.txAmountChanged.bind(this);

        /*
         *  Vault functions - buy and withdraw credits. Fairly simple stuff.
         */
        this.claimRewards = this.claimRewards.bind(this);
        this.buyCredits = this.buyCredits.bind(this);
        this.withdrawCredits = this.withdrawCredits.bind(this);

        /*
         *  Refresh a round based on the round the user wants to see. This is
         *  largely where we draw all the UI elements on major changes to the
         *  game state (round changed, new round started).
         */
        this.refreshRound = this.refreshRound.bind(this);

        /*
         *  Voting functions. Only valid for the active round as determined by
         *  the block number.
         */
        this.voteRed = this.voteRed.bind(this);
        this.voteBlue = this.voteBlue.bind(this);

        /*
         *  Round related management - advance to current or view old games and
         *  payouts. Only the `round_id` is advanced or changed due to this.
         *  As such, a call to refresh_round is required to update the relevant
         *  game totals.
         */
        this.prevRound = this.prevRound.bind(this);
        this.nextRound = this.nextRound.bind(this);

        this.updateRewardsForRound = this.updateRewardsForRound.bind(this);
        this.updateCreditBalance = this.updateCreditBalance.bind(this);

        this.web3     = null;
        this.contract = null;

        this.state = {
            /*
             *  Constants.
             */
            BLOCK_DIV: 128,

            /*
             *  Active is set enabled if the current game being viewed is the
             *  current round.
             */
            is_active: false,

            /*
             *  Game related statistics - game id, and totals to render.
             */
            round_id: -1,
            current_block: -1,
            ongoing_round_id: -1,
            red_total: Number(-1),
            blue_total: Number(-1),
            round_rewards: Number(0),
            round_bets: Number(0),
            round_claimable: false,

            /*
             *  Input field for vote value, deposit, and withdrawal amount.
             */
            tx_amount: 100,

            /*
             *  Local rendering related state variables.
             */
            red_percent: 50.0,
            blue_percent: 50.0,

            /*
             * Vault - mirror of balance etc and effective positive $$.
             */
            credit_balance: 0,
        };
    }

    // mounted ::
    componentDidMount() {
        LoadWeb3.then(results => {
            this.web3 = results.web3;
            this.instantiateContract();
        }).catch(() => {
            console.log("Unable to load Web3");
        });
    }

    ////////////////////////////////////////////////////////////////////////////
    // Helpers.
    ////////////////////////////////////////////////////////////////////////////

    resolve_promise = (f, args=[]) => {
        return new Promise((resolve, reject) => {
            f(...args, (err, result) => {
                if (err !== null) reject(err);
                else resolve(result);
            });
        });
    }

    getPercentage(v, sum) {
        if (sum === 0) return 50;
        if (v === sum) return 100;
        if (v === 0) return 0;
        return (100.0 * v) / sum;
    }

    getPercentageStr(v, sum) {
        let s = ("" + this.getPercentage(v, sum));
        if (s.length > 5) {
            s = s.slice(0, 5)
        }
        return s;
    }

    ////////////////////////////////////////////////////////////////////////////
    //  Contract basics.
    ////////////////////////////////////////////////////////////////////////////

    instantiateContract = async () => {
        const contract = require("truffle-contract");
        const RVB = contract(RedVsBlueABI);
        RVB.setProvider(this.web3.currentProvider);
        RVB.deployed().then(async (instance) => {
            this.contract = instance;
            this.subscribeToEvents();
            await this.refreshRound();
            await this.updateCreditBalance();
        });
    }

    subscribeToEvents = async () => {
        this.contract.NewVoteCast().on("data", event => {
            this.refreshRound();
        });

    }

    ////////////////////////////////////////////////////////////////////////////
    //  Accounts and other web3.eth stuff.
    ////////////////////////////////////////////////////////////////////////////

    getFirstAccount = async () => {
        const accounts = await this.resolve_promise(this.web3.eth.getAccounts);
        if (accounts.length === 0) {
            alert("At-least one account must exist!");
            return;
        }
        return accounts[0];
    }

    getBlocksLeftInRound = async () => {
        const bn = await this.resolve_promise(this.web3.eth.getBlockNumber);
        return parseInt(bn % this.state.BLOCK_DIV);
    }

    getRoundFromETH = async () => {
        const bn = await this.resolve_promise(this.web3.eth.getBlockNumber);
        return parseInt(bn / this.state.BLOCK_DIV);
    }

    ////////////////////////////////////////////////////////////////////////////
    //  Round updates for totals, percentages UI etc as well as refresh logic.
    ////////////////////////////////////////////////////////////////////////////

    updatePercentages() {
        const sum = this.state.red_total + this.state.blue_total;
        this.setState({
            red_percent: this.getPercentage(this.state.red_total, sum),
            blue_percent: this.getPercentage(this.state.blue_total, sum),
        });
    }

    updateRoundTotals = async () => {
        const app_account = await this.getFirstAccount();
        this.contract.GetGameTotals(this.state.round_id, {
            from: app_account,
        }).then((result, err) => {
            this.setState({
                red_total: Number(this.web3.fromWei(result[0], 'milli')),
                blue_total: Number(this.web3.fromWei(result[1], 'milli')),
            }, this.updatePercentages);
        });

        this.updateRewardsForRound();
    }

    refreshRound = async () => {
        const latest_round = await this.getRoundFromETH();
        const blocks_left  = await this.getBlocksLeftInRound();

        /*
         *  First time we are being called - set the current and latest round
         *  to the same value.
         */
        if (this.state.round_id === -1) {
            this.setState({
                round_id: latest_round,
                ongoing_round_id: latest_round,
                is_active: true,
                current_block: blocks_left,
            }, this.updateRoundTotals);
        }

        /*
         *  Subsequent call, only update the latest round and not the round that
         *  the viewer is potentially seeing.
         */
        else {
            this.setState({
                ongoing_round_id: latest_round,
                is_active: (this.state.round_id === latest_round),
                current_block: blocks_left,
            }, this.updateRoundTotals);
        }
    }

    prevRound = async () => {
        if (this.state.round_id > 0) {
            this.setState({
                round_id: this.state.round_id - 1,
                is_active: false,
            }, this.refreshRound);
        }
    }

    nextRound = async () => {
        if (this.state.round_id < this.state.ongoing_round_id) {
            const is_active = (this.state.ongoing_round_id === this.state.round_id + 1);
            this.setState({
                round_id: this.state.round_id + 1,
                is_active: is_active,
            }, this.refreshRound);
        }
    }

    latestRound = async () => {
        const latest_round = await this.getRoundFromETH();
        this.setState({
            round_id: latest_round,
            ongoing_round_id: latest_round,
            is_active: true,
        }, this.refreshRound);
    }

    ////////////////////////////////////////////////////////////////////////////
    // Contract Vault functions.
    ////////////////////////////////////////////////////////////////////////////

    buyCredits = async () => {
        const app_account = await this.getFirstAccount();
        this.contract.BuyCredits({
            from: app_account,
            value: this.web3.toWei(this.state.tx_amount, 'milli'),
        }).then((tx, err) => {
            if (err) {
                alert("Error buying credits -- try again!");
                return;
            }
            this.updateCreditBalance();
        });
    }

    withdrawCredits = async () => {
        const app_account = await this.getFirstAccount();
        this.contract.WithdrawCredits(
            this.web3.toWei(this.state.tx_amount, 'milli'),
            {
                from: app_account,
            }
        ).then((tx, err) => {
            if (err) {
                alert("Error buying credits -- try again!");
                return;
            }
            this.updateCreditBalance();
        });
    }

    updateRewardsForRound = async () => {
        const app_account = await this.getFirstAccount();
        this.contract.GetEarnings(this.state.round_id, {
            from: app_account,
        }).then((result) => {
            const winnings = this.web3.fromWei(result[0], 'milli');
            const bet_amount = this.web3.fromWei(result[1], 'milli');
            const claimed = result[2];
            this.setState({
                round_rewards: winnings,
                round_bets: bet_amount,
                round_claimable: !claimed,
            });
        });
    }

    updateCreditBalance = async () => {
        const app_account = await this.getFirstAccount();
        this.contract.GetCreditBalance({
            from: app_account,
        }).then((balance) => {
            const credits = Number(this.web3.fromWei(balance, 'milli'));
            this.setState({credit_balance: credits});
        });
    }

    claimRewards = async () => {
        const app_account = await this.getFirstAccount();
        this.contract.ClaimEarnings(this.state.round_id, {
            from: app_account,
        }).then((result) => {
            this.updateCreditBalance();
            this.updateRewardsForRound();
        });
    }

    ////////////////////////////////////////////////////////////////////////////

    castVote = async (is_blue) => {
        const app_account = await this.getFirstAccount();
        this.contract.CastVote(
            this.web3.toWei(this.state.tx_amount, 'milli'),
            is_blue,
            {
                from: app_account,
            }
        ).then((tx, err) => {
            if (err) {
                alert("Error casting vote -- try again!");
                return;
            }
            this.updateCreditBalance();
        });
    }

    ////////////////////////////////////////////////////////////////////////////
    // User Interaction.
    ////////////////////////////////////////////////////////////////////////////

    voteRed() { this.castVote(0); }
    voteBlue() { this.castVote(1); }
    txAmountChanged(event) { this.setState({tx_amount: event.target.value}); }

    render() {
        return (
          <div className="App">
            <div className="App-bg">
                <div className="App-header">
                    <div className="App-header-red" style={{width: "50%"}} onClick={this.voteRed}>
                        <div style={{marginRight: "10px"}}>RED:</div>
                        <div>{this.getPercentageStr(this.state.red_total, this.state.red_total + this.state.blue_total)}%</div>
                    </div>
                    <div className="App-header-blue" style={{width: "50%"}} onClick={this.voteBlue}>
                        <div style={{marginRight: "10px"}}>BLUE:</div>
                        <div>{this.getPercentageStr(this.state.blue_total, this.state.red_total + this.state.blue_total)}%</div>
                    </div>
                </div>
                <div className="App-header">
                    <div className="App-header-red" style={{width: "50%"}} onClick={this.voteRed}>
                        <div>{this.state.red_total}</div>
                    </div>
                    <div className="App-header-blue" style={{width: "50%"}} onClick={this.voteBlue}>
                        <div>{this.state.blue_total}</div>
                    </div>
                </div>
                <div className="App-split">
                    <div className="App-red" style={{width: this.getPercentage(this.state.red_total, this.state.red_total + this.state.blue_total)+"%"}}>
                        {!this.state.is_active && this.state.red_total > this.state.blue_total && <span>WINNER</span>}
                        {this.state.is_active && this.state.red_total > this.state.blue_total && <span>WINNING</span>}
                        {!this.state.is_active && this.state.blue_total > this.state.red_total && <span>LOSER</span>}
                        {this.state.is_active && this.state.blue_total > this.state.red_total && <span>LOSING</span>}
                        {!this.state.is_active && this.state.blue_total === this.state.red_total && <span>TIED</span>}
                        {this.state.is_active && this.state.blue_total === this.state.red_total && <span>TIE</span>}
                    </div>
                    <div className="App-blue" style={{width: this.getPercentage(this.state.blue_total, this.state.red_total + this.state.blue_total)+"%"}}>
                        {!this.state.is_active && this.state.red_total > this.state.blue_total && <span>LOSER</span>}
                        {this.state.is_active && this.state.red_total > this.state.blue_total && <span>LOSING</span>}
                        {!this.state.is_active && this.state.blue_total > this.state.red_total && <span>WINNER</span>}
                        {this.state.is_active && this.state.blue_total > this.state.red_total && <span>WINNING</span>}
                        {!this.state.is_active && this.state.blue_total === this.state.red_total && <span>TIED</span>}
                        {this.state.is_active && this.state.blue_total === this.state.red_total && <span>TIE</span>}
                    </div>
                </div>
            </div>
            <div className="App-body">
                <div>
                    <h4>
                        <div>A game of tug-of-war for degens.</div>
                        <div>
                            <span>Round: </span>
                            {this.state.round_id > 0 && <button className="link-button" onClick={this.prevRound}>&lt;</button>}
                            {this.state.round_id}{this.state.is_active && <span> [ongoing] </span>}
                            {!this.state.is_active && <button className="link-button" onClick={this.nextRound}>&gt;</button>}
                            {!this.state.is_active && <span className="App-latest-btn" onClick={this.latestRound}> latest</span>}
                        </div>
                    </h4>
                    <p>* No token b/s, 1 ETH == 1000 credits</p>
                    <p>* New round every {this.state.BLOCK_DIV} blocks [{this.state.BLOCK_DIV - this.state.current_block} blocks left]</p>
                    <p>* Losing color pays winning color</p>
                    <p>* No fees, contract <a href="https://github.com/Red-vs-Blu/RedVsBlue/blob/master/contracts/RedVsBlue.sol">here</a></p>
                    {!this.state.is_active &&
                        <p>* Result: {this.state.round_rewards}
                            {this.state.round_rewards >= this.state.round_bets && <span className="profit"> (+{this.state.round_rewards - this.state.round_bets})</span>}
                            {this.state.round_rewards < this.state.round_bets && <span className="loss"> ({this.state.round_rewards - this.state.round_bets})</span>}
                            {this.state.round_claimable && this.state.round_rewards > 0 && <button type="button" className="link-button" onClick={this.claimRewards}>claim</button>}
                            {!this.state.round_claimable && this.state.round_rewards > 0 && <span> [claimed] </span>}
                        </p>
                    }
                    {this.state.is_active &&
                        <p>* Ongoing round,
                            <span className="color-red"> {this.state.red_total} </span>
                            vs
                            <span className="color-blue"> {this.state.blue_total} </span>
                        </p>
                    }
                </div>
                <br></br>
                <div>
                    <h4>You have {this.state.credit_balance} credits!</h4>
                    <div className="App-input">
                        {this.state.is_active && <div className="App-red" onClick={this.voteRed}>Vote Red</div>}
                        <input type="number" value={this.state.tx_amount} onChange={this.txAmountChanged} />
                        {this.state.is_active && <div className="App-blue" onClick={this.voteBlue}>Vote Blue</div>}
                    </div>
                    <div className="App-toolbar">
                        <button type="button" className="link-button" onClick={this.buyCredits}>+ Deposit</button>
                        <button type="button" className="link-button" onClick={this.withdrawCredits}>- Withdraw</button>
                    </div>
                </div>
                <br></br>
            </div>
          </div>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export default App;

////////////////////////////////////////////////////////////////////////////////
