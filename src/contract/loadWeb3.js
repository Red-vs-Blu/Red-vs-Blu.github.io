// Contract details + web3 loading.
import Web3 from "web3";

// Promise that loads or injects a web3 instance.
let LoadWeb3 = new Promise(function(resolve, reject) {
    var web3 = window.web3;
    if (window.ethereum) {
        web3 = new Web3(window.ethereum);
    }
    if (typeof web3 !== "undefined") {
        console.log("Detected pre-injected Web3");
        resolve({ web3: web3 });
    } else {
        var provider = new Web3.providers.HttpProvider("http://127.0.0.1:7545");
        console.log("No Web3 instance found, using local http provider");
        resolve({ web3: new Web3(provider) });
    }
});

export default LoadWeb3;
