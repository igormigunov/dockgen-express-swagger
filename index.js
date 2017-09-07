'use strict';

const swagger = require('./swagger.json');
const promisify = require('util').promisify;
const _ = require('lodash');
const fs = require('fs');

const truncate = promisify(fs.truncate);
const writeFile = promisify(fs.writeFile);


const parseByType = (data) => {
	let type = data.schema._type;
	let result = {};
	const key = data.key
	let description =  data.schema._notes.join(', ');
	const defaultValue = data.schema._flags.default;
	switch (type) {
		case 'alternatives':
			result = { [key]: data.schema._inner.matches.map((item) => parseByType(item)) }
			break;
		case 'any':
			const allow = data.schema._valids._set || []
			result = { [key]: { type: 'any', values: allow, description, default: defaultValue } }
			break;
		case 'string':
			let pattern = null
			if (data.schema._tests.length === 1 && data.schema._tests[0].arg) {
				pattern = data.schema._tests[0].arg.pattern;
			}
			const ob = { type, pattern: pattern ? pattern.toString() : null, description, default: defaultValue };
			result = key ? { [key]: ob } : ob;
			break;
		case 'number':
			const isInteger = data.schema._tests.some(i => i.name === 'integer');
			const isPositive = data.schema._tests.some(i => i.name === 'positive');
			if (isInteger) type = 'integer';
			if (isPositive) description = `${description} positive`;
		default:
			result = key ? { [key]: { type, description, default: defaultValue } } : { type, description, default: defaultValue };
	}
	return result;
}
const parseSchema = schema => Object.keys(schema).reduce((res, key) => {
	const d = schema[key]._inner.children.reduce((r, i) => Object.assign(r, parseByType(i)), {});
	return Object.assign(res, { [key]: d })
}, {});

var getRouteCelebrates = function (route) {
	var schemas = {};
	const middlewares = route.stack.filter(item => item.name === 'middleware');
	middlewares.forEach((middleware) => {
		const schema = middleware.handle._schema;
		const method = middleware.method.toLowerCase();
		if (schema && method) {
			Object.assign(schemas, { [method]: parseSchema(schema) });
		}
	})

	return schemas
}

const getRouteMethods = function (route, celebrates) {
	var methods = {}

	for (var method in route.methods) {
		if (method === '_all') continue
		const result = { [method.toLowerCase()]: celebrates[method.toLowerCase()] }
		Object.assign(methods, result)
	}

	return methods
}
/**
 * Return true if found regexp related with express params
 */
var hasParams = function (value) {
	var regExp = /\(\?:\(\[\^\\\/]\+\?\)\)/g
	return regExp.test(value)
}

/**
 * Return an array of strings with all the detected endpoints
 */
var getEndpoints = function (app, path, endpoints) {
	var regExp = /^\/\^\\\/(?:(:?[\w\\.-]*(?:\\\/:?[\w\\.-]*)*)|(\(\?:\(\[\^\\\/]\+\?\)\)))\\\/.*/
	var stack = app.stack || app._router && app._router.stack

	endpoints = endpoints || []
	path = path || ''

	stack.forEach(function (val) {
		if (val.route) {
			const celebrates = getRouteCelebrates(val.route);
			endpoints.push({
				path: path + (path && val.route.path === '/' ? '' : val.route.path),
				methods: getRouteMethods(val.route, celebrates),
			})
		} else if (val.name === 'router' || val.name === 'bound dispatch') {
			var newPath = regExp.exec(val.regexp)

			if (newPath) {
				var parsedRegexp = val.regexp
				var keyIndex = 0
				var parsedPath

				while (hasParams(parsedRegexp)) {
					parsedRegexp = val.regexp.toString().replace(/\(\?:\(\[\^\\\/]\+\?\)\)/g, ':' + val.keys[keyIndex].name)
					keyIndex++
				}

				if (parsedRegexp !== val.regexp) {
					newPath = regExp.exec(parsedRegexp)
				}

				parsedPath = newPath[1].replace(/\\\//g, '/')

				if (parsedPath === ':postId/sub-router') console.log(val)

				getEndpoints(val.handle, path + '/' + parsedPath, endpoints)
			} else {
				getEndpoints(val.handle, path, endpoints)
			}
		}
	})

	return endpoints;
}
const generateJson = (app, options = {}) => {
	try {
		console.log('Start generation documentation')
		const data = getEndpoints(app);
		let json = options.json ? Object.assign({}, options.json) : swagger;
		const paths = {};
		data.forEach((route) => {
			if (route.path.search(/\*/) === -1) {
				const routePathFormated = route.path.replace(/\/\:([^\/]+)\/?/g, '/{$1}/')
				const result = Object.keys(route.methods).reduce((res, method) => {
					const summary = _.result(json.paths, `${routePathFormated}.${method}.summary`);
					const tags = _.result(json.paths, `${routePathFormated}.${method}.tags`);
					const produces = _.result(json.paths, `${routePathFormated}.${method}.produces`);
					const responses = _.result(json.paths, `${routePathFormated}.${method}.responses`);
					const dFormated = _.reduce(route.methods[method], (r, v, k) => {
						_.forEach(v, d => (d.in = k));
						return Object.assign(r, v);
					}, {});
					const bodyProps = {};
					const currentParameters = _.chain(dFormated).map((v, ind) => {
						let item = null;
						if (_.isArray(v)) {
							v.description = v.map(i => `${i.type} ${i.description}`).join(' or ');
						}
						const fDescr = v.description || v.pattern || (v.values && v.values.join(', ')) || '';
						if (v.in === 'body') {
							Object.assign(bodyProps, { [ind]: {
								type: v.type || 'string',
								description: fDescr,
								default: v.default
							} });
						} else {
							item = {
								name: v.originalKey || ind,
								in: v.in === 'params' ? 'path' : v.in,
								description: fDescr,
								type: v.type || 'string',
								required: v.in === 'params',
								default: v.default
							};
							Object.assign(item, v.values ? { enum: v.values } : {})
						}
						return item;
					}).compact().value();
					if (Object.keys(bodyProps).length > 0) {
						currentParameters.push({
							name: 'body',
							in: 'body',
							schema: {
								properties: bodyProps
							}
						});
					}
					const d = {
						tags: tags || [routePathFormated.replace(/[\{\}]/g, '').split('/')[2]],
						summary: summary || `${method.toUpperCase()} - ${routePathFormated}`,
						produces: produces || ['application/json'],
						parameters: currentParameters,
						responses
					};
					if (d.parameters.length === 0) {
						return res;
					}
					return Object.assign(res, { [method]: d });
				}, {});
				if (Object.keys(result).length > 0) {
					Object.assign(paths, { [routePathFormated]: result });
				}
			}
		});
		json.paths = paths;
		fs.exists('api/swagger/swagger.json', (exists) => {
			if (exists) {
				truncate('api/swagger/swagger.json', 0)
					.then((res) => writeFile('api/swagger/swagger.json', JSON.stringify(json, null, 4)))
					.then(() => console.log('Documentation has been overwritten'))
					.catch(err => console.log(err));
			} else {
				writeFile('api/swagger/swagger.json', JSON.stringify(json, null, 4))
					.then(() => console.log('Documentation has been generated'));
			}
		});
		return json;
	} catch (err) {
		console.log(err);
	}
}

module.exports = generateJson;
