serve:
	npm start

deps:
	npm install

deploy-init:
	npm run deploy

build:
	npm run build

deploy:
	git push origin `git subtree split --prefix build master`:gh-pages --force
