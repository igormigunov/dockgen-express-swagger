'use strict';

const swagger = require('./swagger.json');
const promisify = require('util').promisify;
const _ = require('lodash');
const fs = require('fs');
const fsExtra = require('fs-extra');

const truncate = promisify(fs.truncate);
const writeFile = promisify(fs.writeFile);

const { getErrorsFromRoutes } = require('./modules');

const parseResponses = (data) => {
	const validResponse = data.valid;
	if (!validResponse) return data;
	return Object.assign(validResponse, Object.keys(data).reduce((res, key) => {
		if (key !== 'valid') {
			let errors = data[key].replace(/\s/g, '').split(',');
			if (errors.length > 1) {
				return Object.assign(res, { [key]: getTemplateForResponse(errors, true) })
			} else {
				return Object.assign(res, { [key]: getTemplateForResponse(errors) })
			}
		}
		return res;
	}, {}));
}
const parseByType = (data) => {
	let type = data.schema._type;
	let result = {};
	const key = data.key
	let description =  data.schema._notes.join(', ');
	const defaultValue = data.schema._flags.default;
	const values = data.schema._valids._set || []
	switch (type) {
		case 'alternatives':
			result = { [key]: data.schema._inner.matches.map((item) => parseByType(item)) }
			break;
		case 'any':
			result = { [key]: { type: 'string', values, description, default: defaultValue } }
			break;
		case 'string':
			let pattern = null
			if (data.schema._tests.length === 1 && data.schema._tests[0].arg) {
				pattern = data.schema._tests[0].arg.pattern;
			}
			const ob = { type, pattern: pattern ? pattern.toString() : null, description, default: defaultValue, values };
			result = key ? { [key]: ob } : ob;
			break;
		case 'date':
			result = { [key]: { format: 'date-time', type: 'string', description  } };
			break;
		case 'number':
			const isInteger = data.schema._tests.some(i => i.name === 'integer');
			const isPositive = data.schema._tests.some(i => i.name === 'positive');
			if (isInteger) type = 'integer';
			if (isPositive) description = `${description} positive`;
		default:
			result = key ? { [key]: { type, description, default: defaultValue, values } } : { type, description, default: defaultValue, values };
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
const getSchemaType = (item) => {
	const ref = item.ref ? {
		"$ref": `#/definitions/${item.ref}`
	} : null
	if (_.isArray(item)) {
		if (item[0].name || (item[0].type && item[0].type.name)) {
			return {
				type: 'array',
				items: getSchemaType(item[0])
			}
		} else { //Nested Array
			const schema = {}
			_.each(item[0], (v, k) => Object.assign(schema, { [k]: getSchemaType(v) }))
			return {
				type: 'array',
				items: {
					type: 'object',
					properties: schema
				}
			}
		}
	}
	let typeName = item.name || (item.type && item.type.name)
	const ex = {}
	switch (typeName) {
		case "ObjectId":
		case "Mixed":
			typeName = 'object';
			break;
		case "Date":
			typeName = 'string'
			ex.format = 'date-time'
			break;
	}
	return typeName && Object.assign(!ref ? { type: typeName.toLowerCase() } : {}, ref, ex);

}
const generateDefinitions = (models, rootPath) => {
	console.log('Start generating definitions')
	const result = {};
	_.each(models, (model, key) => {
		const { nested, obj } = model.schema;
		result[key] = {};
		_.each(obj, (item, field) => {
			if (!nested[field]) {
				Object.assign(result[key], { [field]: getSchemaType(item) })
			} else {
				result[key][field] = {
					type: 'object',
					properties: {}
				}
				_.each(item, (nestedItem, nestedKey) => {
					Object.assign(result[key][field].properties, { [nestedKey]: getSchemaType(nestedItem) })
				})
			}
		})
	})
	_.each(result, (properties, key) => {
		const dataFormated = {
			type: 'object',
			properties
		}
		fsExtra.outputJsonSync(`${rootPath}definitions/${key}.json`, dataFormated, { spaces: 2 })
	})
	return result

}
const findNested = (obj, key, memo) => {
	var i,
		proto = Object.prototype,
		ts = proto.toString,
		hasOwn = proto.hasOwnProperty.bind(obj);

	if ('[object Array]' !== ts.call(memo)) memo = [];

	for (i in obj) {
		if (hasOwn(i)) {
			if (i === key) {
				memo.push(obj[i]);
			} else if ('[object Array]' === ts.call(obj[i]) || '[object Object]' === ts.call(obj[i])) {
				findNested(obj[i], key, memo);
			}
		}
	}

	return memo;
}
const getRefs = (ref, defRoot, result, l = 1) => {
	result.unshift(`${ref}---${l}`)
	if (fsExtra.pathExistsSync(`${defRoot}${ref}.json`)) {
		const refData = fsExtra.readJsonSync(`${defRoot}${ref}.json`)
		const nestedRefs =
			_.chain(findNested(refData, '$ref').map(i => i.replace('#/definitions/','')))
				.uniq()
				.pullAll(result.map(i => i.substr(0, i.length - 4)))
				.value();
		_.each(nestedRefs, ref => getRefs(ref, defRoot, result, l + 1))
	}

}
const getTemplateForResponse = (data, isEnum) => {
	const enumValue = isEnum ? data : '';
	return {
		schema: {
			type: 'object',
			properties: {
				tsl: Object.assign({
					type: 'string',
					default: data[0],
				}, isEnum ? { enum: enumValue } : {})
			}
		},
		description: isEnum ? `one from list ${enumValue.join(', ')}` : data[0]
	}
};
const setStatistics = (totalResults, responses, currentParameters, method, routePathFormated) => {
	totalResults.all += 1;
	if (currentParameters.length === 0) {
		totalResults.withoutParams.count += 1;
		totalResults.withoutParams.list.push(`${method} ${routePathFormated}`)
	}
	if (!Object.keys(responses).length) {
		totalResults.withoutResponse.count += 1;
		totalResults.withoutResponse.list.push(`${method} ${routePathFormated}`)
	}
	if (currentParameters.length === 0 && !Object.keys(responses).length) {
		totalResults.empty.count += 1;
		totalResults.empty.list.push(`${method} ${routePathFormated}`)
	}
	if (currentParameters.length !== 0 && Object.keys(responses).length) {
		totalResults.completed.count += 1;
		totalResults.completed.list.push(`${method} ${routePathFormated}`)
	}
}
const generateJson = (app, options = {}) => {
	try {
		console.log('Start generating documentation')
		const rootPath = options.rootPath || 'api/swagger/';
		generateDefinitions(app.lib.models, rootPath);
		const data = getEndpoints(app);
		let json = options.json ? Object.assign({}, options.json) : swagger;
		const hideEmpty = options.hideEmpty;
		const resetParams = options.resetParams;
		const paths = {};
		let definitions = [];
		const totalResults = {
			all: 0,
			empty: {
				count: 0,
				list: []
			},
			completed: {
				count: 0,
				list: []
			},
			withoutParams: {
				count: 0,
				list: []
			},
			withoutResponse: {
				count: 0,
				list: []
			}
		};
		data.forEach((route) => {
			if (route.path.search(/\*/) === -1) {
				const routePathFormated = route.path.replace(/\/\:([^\/]+)\/?/g, '/{$1}/');
				if (routePathFormated === '/') return true;
				fsExtra.mkdirsSync(`${rootPath}routes${routePathFormated}`);
				const tag = routePathFormated.replace(/[\{\}]/g, '').split('/')[2];
				const result = Object.keys(route.methods).reduce((res, method) => {
					const routeMethodPath = `${rootPath}routes${routePathFormated}/${method}/`
					let mainData = {
						tags: tag ? [tag] : ['default'],
						summary: `${method.toUpperCase()} - ${routePathFormated}`,
						produces:['application/json']
					};
					if (fsExtra.pathExistsSync(`${routeMethodPath}index.json`)) {
						mainData = fsExtra.readJsonSync(`${routeMethodPath}index.json`)
					}
					let responses = {};
					if (fsExtra.pathExistsSync(`${routeMethodPath}responses.json`)) {
						responses = parseResponses(fsExtra.readJsonSync(`${routeMethodPath}responses.json`))
						const refs = findNested(responses, '$ref').map(i => i.replace('#/definitions/',''));
						const refsResult = [];
						_.each(refs, ref => getRefs(ref, `${rootPath}definitions/`, refsResult))
						definitions = _.union(definitions, refsResult)
					}
					let parameters = [];
					if (fsExtra.pathExistsSync(`${routeMethodPath}parameters.json`)) {
						parameters = fsExtra.readJsonSync(`${routeMethodPath}parameters.json`)
					}
					const dFormated = _.reduce(route.methods[method], (r, v, k) => {
						_.forEach(v, d => (d.in = k));
						return Object.assign(r, v);
					}, {});
					let bodyProps = {};
					let currentParameters = _.chain(dFormated).map((v, ind) => {
						let item = null;
						if (_.isArray(v)) {
							v.description = v.map(i => `${i.type} ${i.description}`).join(' or ');
						}
						const fDescr = v.description || v.pattern || (v.values && v.values.join(', ')) || '';
						if (v.in === 'body') {
							Object.assign(bodyProps, { [ind]: {
								type: v.type || 'string',
								description: fDescr,
								default: v.default,
								format: v.format
							} });
						} else {
							item = {
								name: v.originalKey || ind,
								in: v.in === 'params' ? 'path' : v.in,
								description: fDescr,
								type: v.type || 'string',
								required: v.in === 'params',
								default: v.default,
								format: v.format
							};
							Object.assign(item, (v.values && v.values.length > 0) ? { enum: v.values } : {})
						}
						return item;
					}).compact().value();
					if (Object.keys(bodyProps).length > 0) {
						const currentBody = parameters.find(item => item.in === 'body')
						if (currentBody && !resetParams) {
							Object.keys(currentBody.schema.properties).forEach((key) => {
								Object.assign(bodyProps[key], currentBody.schema.properties[key])
							})
						}
						currentParameters.push({
							name: 'body',
							in: 'body',
							schema: {
								properties: bodyProps
							}
						});
					} else if(!resetParams){
						currentParameters = _.unionBy(parameters, currentParameters, 'name')
					}
					setStatistics(totalResults, responses, currentParameters, method, routePathFormated);
					if (currentParameters.length === 0 && hideEmpty) {
						return res;
					}
					fsExtra.outputJsonSync(`${rootPath}routes${routePathFormated}/${method}/index.json`, mainData, { spaces: 2 })
					//fsExtra.outputJsonSync(`${rootPath}routes${routePathFormated}/${method}/responses.json`, responses, { spaces: 2 })
					fsExtra.outputJsonSync(`${rootPath}routes${routePathFormated}/${method}/parameters.json`, currentParameters, { spaces: 2 })
					const d = Object.assign({}, mainData,
						Object.keys(responses).length ? { responses } : { responses : { 200: { description: '' } }},
						currentParameters.length ? { parameters: currentParameters } : {}
					);
					return Object.assign(res, { [method]: d });
				}, {});
				if (Object.keys(result).length > 0) {
					Object.assign(paths, { [routePathFormated]: result });
				}
			}
		});
		json.paths = paths;
		if (fsExtra.pathExistsSync(`${rootPath}definitions`) && definitions.length) {
			const defResult = {};
			const defsFormated = _.chain(definitions)
				.sortBy([i => -1 * parseInt(i.substr(-1), 10)])
				.map(i => i.substr(0, i.length - 4))
				.uniq()
				.value()
			_.each(defsFormated, (def) => {
				if (fsExtra.pathExistsSync(`${rootPath}definitions/${def}.json`)) {
					defResult[def] = fsExtra.readJsonSync(`${rootPath}definitions/${def}.json`)
				}
			})
			json.definitions = defResult;
		}
		fsExtra.outputJsonSync(`${rootPath}swagger.json`, json)
		console.log("Documentation has been generated")
		console.log(JSON.stringify(totalResults, null, 2))
		return true
	} catch (err) {
		console.log(err);
	}
}

module.exports = generateJson;
