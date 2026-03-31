'use strict';

const modelExtendsFn = require('./modelExtends');
const hooksUniversalFn = require('./hooksUniversal');
const errors = require('./errors');

module.exports = function(Sequelize) {
	if (!Sequelize) Sequelize = require('sequelize');

	// Add custom errors to Sequelize
	errors(Sequelize);

	// Extend Model
	const modelExtends = modelExtendsFn(Sequelize);
	Object.assign(Sequelize.Model, modelExtends);

	// Add hook on Sequelize() to create universal hooks
	const hooksUniversal = hooksUniversalFn(Sequelize);
	Sequelize.addHook('afterInit', 'sequelizeHierarchyInit', (sequelize) => {
		for (const [hookName, hookFn] of Object.entries(hooksUniversal)) {
			sequelize.addHook(hookName, hookFn);
		}
	});

	return Sequelize;
};
