'use strict';

const esprima = require('esprima');
const fs = require('fs');
const path = require('path');
const errorsDictionary = require('api/constants').errors;

const getEndpoint = (data, resultDataOfEndpoints, endpoints) => {
	let validator = null;
	let refToDataWithErrors = null;
	const endpointType = data.callee.property.name;
	const errors = [];
	if (data.arguments.length === 2) {
		validator = data.arguments[0].arguments[0].property.name;
		refToDataWithErrors = data.arguments[1].body.body[0].block.body;
	} else {
		refToDataWithErrors = data.arguments[0].body.body;
	}
	refToDataWithErrors.forEach((block) => { //  || block.consequent.body[0].type === 'ThrowStatement')
		if (block.consequent && block.consequent.type === 'ThrowStatement') {
			const errorName = block.consequent.argument.arguments[0].object.property.name;
			errors.push({
				name: errorName,
				status: errorsDictionary[errorName].status
			});
		}
	});
	endpoints.arrayOfEndpoints.push({
		validator,
		endpointType,
		errors: [].concat(errors),
	});
	if (data.callee.object.arguments[0].type === 'Literal') {
		resultDataOfEndpoints.push({
			route: data.callee.object.arguments[0].value,
			endpoints: [].concat(endpoints.arrayOfEndpoints),
		});
		return true;
	}
	getEndpoint(data.callee.object, resultDataOfEndpoints, endpoints);
};
const getEndpoints = (routes, resultDataOfEndpoints) => {
	routes.forEach((route) => {
		const endpoints = {
			route: '',
			arrayOfEndpoints: []
		};
		getEndpoint(route.expression, resultDataOfEndpoints, endpoints);
	});
	return resultDataOfEndpoints;
};
const getBodyExpressions = (array, element) => {
	if (element.type === 'ExpressionStatement' && element.expression.right) {
		if (element.expression.right.body) {
			element.expression.right.body.body.forEach((data) => {
				if (data.type === 'ExpressionStatement') array.push(data);
			});
		}
	}
	return array;
}

module.exports = {
	getErrorsFromRoutes: (data) => {
		// const files = fs.readdirSync('api/routes/');
		const read = (dir) =>
			fs.readdirSync(dir)
				.reduce((files, file) =>
						fs.statSync(path.join(dir, file)).isDirectory() ?
							files.concat(read(path.join(dir, file))) :
							files.concat(path.join(dir, file)),
					[]);
		const files = read('api/routes/');

		return files.map((file) => {
			const resultDataOfEndpoints = [];

			const content = esprima.parseScript(fs.readFileSync(file, 'utf-8'), { tokens: true });
			const routes = content.body.reduce(getBodyExpressions, []);

			getEndpoints(routes, resultDataOfEndpoints);

			return { file, resultDataOfEndpoints };
		});
	}
};
