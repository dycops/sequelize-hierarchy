'use strict';

const {Model} = require('sequelize');

module.exports = (Sequelize) => {
	const {HierarchyError} = Sequelize;

	return {
		afterDefine,
		beforeFindAfterExpandIncludeAll,
		afterFind
	};

	function afterDefine(model) {
		let {hierarchy} = model.options;

		for (const [fieldName, field] of Object.entries(model.getAttributes())) {
			if (!field.hierarchy) continue;

			if (hierarchy) {
				throw new HierarchyError(`You cannot define hierarchy on two attributes, or an attribute and the model options, in '${model.name}'`);
			}

			hierarchy = field.hierarchy;
			if (hierarchy === true) hierarchy = {};

			hierarchy.foreignKey = fieldName;
			const primaryKey = hierarchy.primaryKey || model.primaryKeyAttribute;
			if (!hierarchy.as) {
				const pk = primaryKey[0].toUpperCase() + primaryKey.slice(1);
				if (fieldName.endsWith(pk)) {
					hierarchy.as = fieldName.slice(0, -primaryKey.length);
				} else if (fieldName.endsWith(`_${primaryKey}`)) {
					hierarchy.as = fieldName.slice(0, -primaryKey.length - 1);
				} else {
					hierarchy.as = fieldName;
				}
			}

			model.options.hierarchy = hierarchy;
			field.hierarchy = true;
		}

		if (hierarchy) model.isHierarchy(hierarchy);
	}

	function beforeFindAfterExpandIncludeAll(options) {
		const model = this;

		let hierarchyExists = false;
		if (options.hierarchy) {
			if (!model.hierarchy) {
				throw new HierarchyError(`You cannot get hierarchy of '${model.name}' - it is not hierarchical`);
			}
			hierarchyExists = true;
		}

		options.hierarchyExists = hierarchyExists || checkHierarchy(options, model);
	}

	function afterFind(result, options) {
		if (!result) return;
		if (!options.hierarchyExists) return;

		const model = this,
			{hierarchy} = model;

		let parent;

		if (options.hierarchy && options.includeMap) {
			const include = options.includeMap[hierarchy.through.name];

			if (include && include.where) {
				const parentId = include.where[hierarchy.throughForeignKey];
				if (parentId) parent = {[hierarchy.primaryKey]: parentId};
			}
		}

		convertHierarchies(result, options, model, parent);

		if (parent) {
			result.length = 0;
			result.push(...parent[hierarchy.childrenAs]);
		}
	}

	function checkHierarchy(options, model) {
		if (!options.include) return undefined;

		let hierarchyExists = false;
		for (const include of options.include) {
			const includeModel = include.model;

			if (include.hierarchy) {
				if (!includeModel.hierarchy) {
					throw new HierarchyError(`You cannot get hierarchy of '${includeModel.name}' - it is not hierarchical`);
				}
				if (includeModel.name !== model.name) {
					throw new HierarchyError(`You cannot get a hierarchy of '${includeModel.name}' without including it from a parent`);
				}
				if (include.as !== model.hierarchy.descendentsAs) {
					throw new HierarchyError(`You cannot set hierarchy on '${model.name}' without using the '${model.hierarchy.descendentsAs}' accessor`);
				}

				hierarchyExists = true;
			}

			hierarchyExists = hierarchyExists || checkHierarchy(include, includeModel);
		}

		return hierarchyExists;
	}

	function convertHierarchies(results, options, model, parent) {
		if (!results) return;

		if (options.include) {
			for (const include of options.include) {
				const includeModel = include.model,
					accessor = include.as;

				if (!Array.isArray(results)) results = [results];

				for (const result of results) {
					convertHierarchies(result[accessor], include, includeModel, result);
				}
			}
		}

		if (options.hierarchy) convertHierarchy(results, model, parent);
	}

	function convertHierarchy(results, model, parent) {
		const {hierarchy} = model,
			{primaryKey, foreignKey} = hierarchy,
			childrenAccessor = hierarchy.childrenAs,
			descendentsAccessor = hierarchy.descendentsAs,
			throughAccessor = hierarchy.through.name;

		let parentId, output;
		if (parent) {
			parentId = parent[primaryKey];
			output = [];
			setValue(parent, childrenAccessor, output);
			deleteValue(parent, descendentsAccessor);
		} else {
			parentId = null;
			output = results;
			results = results.slice();
			output.length = 0;
		}

		const references = {};
		for (const item of results) {
			references[`_${item[primaryKey]}`] = item;
		}

		for (const item of results) {
			deleteValue(item, throughAccessor);

			const thisParentId = item[foreignKey];
			if (thisParentId === parentId) {
				output.push(item);
				continue;
			}

			const thisParent = references[`_${thisParentId}`];
			if (!thisParent) {
				throw new HierarchyError(`Parent ID ${thisParentId} not found in result set`);
			}

			let parentChildren = thisParent[childrenAccessor];
			if (!parentChildren) {
				parentChildren = [];
				setValue(thisParent, childrenAccessor, parentChildren);
			}

			parentChildren.push(item);
		}
	}

	function setValue(item, key, value) {
		item[key] = value;
		if (item instanceof Model) item.dataValues[key] = value;
	}

	function deleteValue(item, key) {
		delete item[key];
		if (item instanceof Model) delete item.dataValues[key];
	}
};
