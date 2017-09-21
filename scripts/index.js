'use strict';

const esprima = require('esprima');
const fs = require('fs');
const path = require('path');
const errorsDictionary = require('api/constants').errors;

const getErrorsNestedInBlocks = (block, errors) => {
	if (block.consequent && block.consequent.type === 'ThrowStatement') {
		const errorName = block.consequent.argument.arguments[0].object.property.name;
		errors.push({
			name: errorName,
			status: errorsDictionary[errorName].status
		});
	}
	block.consequent.body.forEach((block) => {
		if (block && block.type === 'ThrowStatement') {
			const errorName = block.argument.arguments[0].object.property.name;
			errors.push({
				name: errorName,
				status: errorsDictionary[errorName].status
			});
		}
		if (block.consequent && (block.consequent.type === 'BlockStatement' || block.consequent.type === 'IfStatement')) {
			//  || block.consequent.body[0].type === 'ThrowStatement')
			if (block.consequent && block.consequent.type === 'ThrowStatement') {
				const errorName = block.consequent.argument.arguments[0].object.property.name;
				errors.push({
					name: errorName,
					status: errorsDictionary[errorName].status
				});
			}
			if (block.consequent && (block.consequent.type === 'BlockStatement' || block.consequent.type === 'IfStatement')) {
				getErrorsNestedInBlocks(block, errors);
			}
		}
	});
};
const getErrFromMainBlock = (arrayBlocks, errors) => {
	arrayBlocks.forEach((block) => { //  || block.consequent.body[0].type === 'ThrowStatement')
		if (block.consequent && block.consequent.type === 'ThrowStatement') {
			const errorName = block.consequent.argument.arguments[0].object.property.name;
			errors.push({
				name: errorName,
				status: errorsDictionary[errorName].status
			});
		}
		if (block.consequent && (block.consequent.type === 'BlockStatement' || block.consequent.type === 'IfStatement')) {
			getErrorsNestedInBlocks(block, errors);
		}
		if (block.type === 'TryStatement') getErrFromMainBlock(block.block.body, errors);
	});
};
const getEndpoint = (data, resultDataOfEndpoints, endpoints) => {
	let validator = null;
	let refToDataWithErrors = null;
	const endpointType = data.callee.property.name;
	const errors = [];
	if (data.arguments.length === 2) {
		validator = data.arguments[0].arguments[0].property.name;
		if (data.arguments[1].body.body.length === 1) {
			refToDataWithErrors = data.arguments[1].body.body[0].block.body;
		} else {
			refToDataWithErrors = data.arguments[1].body.body;
		}
	} else {
		refToDataWithErrors = data.arguments[0].body.body;
	}
	getErrFromMainBlock(refToDataWithErrors, errors);

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
};

module.exports = {
	injectErrorsToRoutes: (data) => {
		// const files = fs.readdirSync('api/routes/');
		const read = (dir) =>
			fs.readdirSync(dir)
				.reduce((files, file) =>
						fs.statSync(path.join(dir, file)).isDirectory() ?
							files.concat(read(path.join(dir, file))) :
							files.concat(path.join(dir, file)),
					[]);
		const files = read('api/routes/');

		const errors = files.map((file) => {
			const resultDataOfEndpoints = [];

			const content = esprima.parseScript(fs.readFileSync(file, 'utf-8'), { tokens: true });
			const routes = content.body.reduce(getBodyExpressions, []);

			getEndpoints(routes, resultDataOfEndpoints);

			return { file, resultDataOfEndpoints, route: file.replace(/api\/routes\/(.+)\.js/, '$1') };
		});
		data.forEach((routeItem) => {
			const routeKeys = routeItem.path.match(/\/?v?\d{0,}\/([a-z0-9]+)(\/.+)?/);
			if (routeKeys && routeKeys[1]) {
				const eItem = errors.find(item => item.route === routeKeys[1]);
				let routeError = null;

				if (eItem) {
					routeError = eItem.resultDataOfEndpoints.find(route => route.route === (routeKeys[2] || '/'));
				}

				routeItem.errors = routeError ?
					routeError.endpoints.reduce(
						(res, item) => Object.assign(res, {[item.endpointType]: item.errors}), {}) :
					null
			}
		})
		return data
	}
};
