module.exports = {
	root: true,
	extends: 'airbnb-base',
	plugins: [
		'standard',
		'import'
	],
	env: {
		browser: false,
		node: true,
		es6: true,
		mocha: true
	},
	parserOptions: {
		sourceType: 'script',
		ecmaFeatures: {
			impliedStrict: false
		}
	},
	settings: {
		'import/resolver': {
			node: {
				moduleDirectory: [
					'node_modules',
					// add project root which is set via `env.NODE_PATH` hack
					'./'
				]
			}
		}
	},
	rules: {
		// reconfigure 'airbnb-base'
		'eqeqeq': 0, // FIXME: consider removing
		'no-shadow': 0, // FIXME: consider removing
		'consistent-return': 0, // FIXME: consider removing
		'no-var': 0,
		'no-void': 0,
		'vars-on-top': 0,
		'camelcase': 0,
		'no-tabs': 0,
		'prefer-const': 0,
		'padded-blocks': 0,
		'prefer-arrow-callback': 0,
		'yoda': 0,
		// own options
		'semi': 2,
		'quotes': [2, 'single'],
		'indent': ["warn", "tab"],
		'strict': [2, 'global'],
		'prefer-template': [ "warn" ],
		'keyword-spacing': [2, { 'before': true, 'after': true }],
		'key-spacing': ['error', { beforeColon: false, afterColon: true, mode: 'minimum' }],
		'curly': 0,
		'space-before-function-paren': [2, 'always'],
		'space-infix-ops': 'error',
		'no-multi-spaces': [ 'error', { 'exceptions': { 'Property': false } } ],
		'semi-spacing': 'error',
		'no-trailing-spaces': 'error',
		'comma-dangle': 0,
		'arrow-body-style': [2, 'as-needed', { requireReturnForObjectLiteral: true }],
		'new-cap': [2, { 'properties': false, capIsNewExceptions: ['Request'] }],
		'import/no-extraneous-dependencies': [2, { 'devDependencies': true }],
		'import/no-unresolved': 0,
		'func-names': 0,
		'max-len': [2, 160],
		'no-param-reassign': 0,
		'no-underscore-dangle': 0,
		'no-plusplus': 0,
		'no-bitwise': 0,
		'import/no-dynamic-require': 0
	}
};
