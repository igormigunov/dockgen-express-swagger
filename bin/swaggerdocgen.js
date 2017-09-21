#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const rootPath = process.cwd();
const appRoot = path.normalize(rootPath);
const { app } = require(`${appRoot}/api/server`);
const generateSwagger = require('../index');
try {

	fs.exists(`${appRoot}api/swagger/swagger.json`, (exists) => {
		if (exists) {
			const json = require(`${appRoot}api/swagger/swagger.json`);
			generateSwagger(app, { json, rootPath: `${appRoot}/api/swagger/`  });
		} else {
			generateSwagger(app, { rootPath: `${appRoot}/api/swagger/` });
		}
		process.stdout.write("Documentation has been generated" +"\n");
		process.exit();
	});
} catch(err) {
	process.stderr.write((err.message ? err.message : err)+"\n");
	process.exit(1);
}
