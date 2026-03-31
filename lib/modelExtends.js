'use strict';

const {Utils, INTEGER} = require('sequelize');
const {addOptions, humanize} = require('./utils');
const hooksModelFn = require('./hooksModel');

module.exports = function(Sequelize) {
	const {
		singularize,
		pluralize,
		underscoredIf
	} = Utils;

	const uppercaseFirst = str => str[0].toUpperCase() + str.slice(1);

	const hooksModel = hooksModelFn(Sequelize);

	return {
		isHierarchy,
		rebuildHierarchy
	};

	function isHierarchy(options) {
		const model = this,
			modelName = model.name,
			{sequelize} = model;

		if (!options || options === true) options = {};

		const modelOptions = model.options,
			globalOptions = sequelize.options.define || {};

		let {underscored} = modelOptions;
		if (underscored == null) underscored = globalOptions.underscored;
		const {underscoredAll} = globalOptions;

		options = Object.assign({
			as: 'parent',
			childrenAs: 'children',
			ancestorsAs: 'ancestors',
			descendentsAs: 'descendents',
			primaryKey: model.primaryKeyAttribute,
			levelFieldName: underscoredIf('hierarchyLevel', underscored),
			levelFieldType: ['postgres', 'mssql'].includes(sequelize.options.dialect)
				? INTEGER
				: INTEGER.UNSIGNED,
			freezeTableName: globalOptions.freezeTableName || false,
			throughSchema: modelOptions.schema,
			camelThrough: globalOptions.camelThrough || false,
			labels: globalOptions.labels || false
		}, sequelize.options.hierarchy || {}, options);

		const {primaryKey, as, ancestorsAs, camelThrough} = options;
		options = Object.assign({
			foreignKey: underscoredIf(`${as}${uppercaseFirst(primaryKey)}`, underscored),
			throughKey: underscoredIf(`${modelName}${uppercaseFirst(primaryKey)}`, underscored),
			throughForeignKey: underscoredIf(
				`${singularize(ancestorsAs)}${uppercaseFirst(primaryKey)}`, underscored
			),
			through: `${modelName}${singularize(
				camelThrough ? uppercaseFirst(ancestorsAs) : ancestorsAs
			)}`
		}, options);

		const {foreignKey} = options;
		let {through, throughTable} = options;
		if (throughTable === undefined) {
			if (options.freezeTableName) {
				throughTable = through;
			} else {
				const ancestorsAsCamel = (camelThrough || underscoredAll)
					? uppercaseFirst(ancestorsAs)
					: ancestorsAs;

				throughTable = underscoredIf(
					`${pluralize(modelName)}${ancestorsAsCamel}`, underscoredAll
				);
				options.throughTable = throughTable;
			}
		}

		let {onDelete} = options;
		if (onDelete == null) {
			onDelete = 'RESTRICT';
		} else {
			onDelete = onDelete.toUpperCase();
			if (!['RESTRICT', 'CASCADE'].includes(onDelete)) {
				throw new Sequelize.HierarchyError("onDelete on hierarchies must be either 'RESTRICT' or 'CASCADE'");
			}
		}
		options.onDelete = onDelete;

		// Record hierarchy in model
		model.hierarchy = options;

		// Add level field to model
		const {levelFieldName} = options;
		const modelAttributes = model.getAttributes();
		modelAttributes[levelFieldName] = {
			type: options.levelFieldType,
			...options.levelFieldAttributes
		};

		// Create associations
		model.hasMany(model, {
			as: options.childrenAs,
			foreignKey,
			targetKey: primaryKey,
			onDelete
		});

		model.belongsTo(model, {
			as,
			foreignKey,
			targetKey: primaryKey
		});

		// Add foreignKey attributes
		if (options.foreignKeyAttributes) {
			Object.assign(model.getAttributes()[foreignKey], options.foreignKeyAttributes);
		}

		// Create labels
		const {labels} = options;
		if (labels) {
			for (const fieldName of [levelFieldName, foreignKey]) {
				const field = model.getAttributes()[fieldName];
				if (field.label === undefined) field.label = humanize(fieldName);
			}
		}

		// Create through table
		const primaryKeyType = model.getAttributes()[primaryKey].type,
			{throughKey, throughForeignKey} = options;
		const throughFields = {};
		for (const fieldName of [throughKey, throughForeignKey]) {
			const field = {type: primaryKeyType, allowNull: false, primaryKey: true};
			if (labels) field.label = humanize(fieldName);
			throughFields[fieldName] = field;
		}

		through = sequelize.define(through, throughFields, {
			timestamps: false,
			paranoid: false,
			tableName: throughTable,
			schema: options.throughSchema
		});
		options.through = through;

		// Create associations through join table
		const {descendentsAs} = options;
		model.belongsToMany(model, {
			as: descendentsAs,
			foreignKey: throughForeignKey,
			through
		});

		model.belongsToMany(model, {
			as: ancestorsAs,
			foreignKey: throughKey,
			through
		});

		// Remove ancestor and descendent setters
		const instanceProto = model.prototype,
			{associations} = model,
			ancestorsAssociationAccessors = associations[ancestorsAs].accessors,
			descendentsAssociationAccessors = associations[descendentsAs].accessors;
		for (const accessorType of [
			'set', 'add', 'addMultiple', 'create', 'remove', 'removeMultiple'
		]) {
			delete instanceProto[ancestorsAssociationAccessors[accessorType]];
			delete ancestorsAssociationAccessors[accessorType];
			delete instanceProto[descendentsAssociationAccessors[accessorType]];
			delete descendentsAssociationAccessors[accessorType];
		}

		// Apply hooks
		for (const [hookName, hookFn] of Object.entries(hooksModel)) {
			model.addHook(hookName, hookFn);
		}

		return model;
	}

	async function rebuildHierarchy(options) {
		if (!options) options = {};

		const model = this,
			{
				primaryKey, foreignKey, levelFieldName, throughKey, throughForeignKey, through
			} = model.hierarchy;

		const passedOptions = addOptions({}, options);

		// Truncate hierarchy through table
		await through.destroy({...passedOptions, truncate: true});

		// Go up tree level by level
		async function processLevel(level, parents) {
			const where = {[foreignKey]: parents ? parents.map(item => item.id) : null};

			let items = await model.findAll(
				addOptions({where, attributes: [primaryKey, foreignKey]}, options)
			);

			if (!items.length) return;

			await model.update(
				{[levelFieldName]: level},
				addOptions({where}, options)
			);

			const ancestors = [];

			items = items.map((item) => {
				const {[primaryKey]: itemId, [foreignKey]: parentId} = item;

				if (!parentId) return {id: itemId, path: [itemId]};

				const parentPath = parents.find(thisItem => thisItem.id === parentId).path;
				for (const ancestorId of parentPath) {
					ancestors.push({[throughKey]: itemId, [throughForeignKey]: ancestorId});
				}

				return {id: itemId, path: parentPath.concat([itemId])};
			});

			await through.bulkCreate(ancestors, passedOptions);

			await processLevel(level + 1, items);
		}

		await processLevel(1);

		return model;
	}
};
