'use strict';

const {addOptions, addToFields, inFields, removeSpacing, replaceTableNames, replaceFieldNames, valueFilteredByFields} = require('./utils');

const PARENT = Symbol('PARENT');

module.exports = (Sequelize) => {
	const {HierarchyError} = Sequelize;

	return {
		beforeCreate,
		afterCreate,
		beforeUpdate,
		beforeBulkCreate,
		beforeBulkUpdate
	};

	async function beforeCreate(item, options) {
		const model = this,
			{primaryKey, foreignKey, levelFieldName} = model.hierarchy,
			values = item.dataValues,
			parentId = valueFilteredByFields(foreignKey, item, options);

		if (!parentId) {
			values[levelFieldName] = 1;
			return;
		}

		const itemId = valueFilteredByFields(primaryKey, item, options);
		if (parentId === itemId) throw new HierarchyError('Parent cannot be a child of itself');

		const parent = await model.findOne(
			addOptions({where: {[primaryKey]: parentId}, attributes: [levelFieldName]}, options)
		);
		if (!parent) throw new HierarchyError('Parent does not exist');

		values[levelFieldName] = parent[levelFieldName] + 1;
		addToFields(levelFieldName, options);
	}

	async function afterCreate(item, options) {
		const model = this,
			{
				primaryKey, foreignKey, levelFieldName, through, throughKey, throughForeignKey
			} = model.hierarchy,
			values = item.dataValues,
			parentId = valueFilteredByFields(foreignKey, item, options);

		if (!parentId) return;

		const itemId = values[primaryKey];

		let ancestors;
		if (values[levelFieldName] === 2) {
			ancestors = [];
		} else {
			ancestors = await through.findAll(
				addOptions({where: {[throughKey]: parentId}, attributes: [throughForeignKey]}, options)
			);
		}

		ancestors.push({[throughForeignKey]: parentId});

		ancestors = ancestors.map(ancestor => ({
			[throughForeignKey]: ancestor[throughForeignKey],
			[throughKey]: itemId
		}));

		await through.bulkCreate(ancestors, addOptions({}, options));
	}

	async function beforeUpdate(item, options) {
		const model = this,
			{sequelize} = model,
			{
				primaryKey, foreignKey, levelFieldName, through, throughKey, throughForeignKey
			} = model.hierarchy,
			values = item.dataValues;

		const itemId = values[primaryKey],
			parentId = values[foreignKey];
		let oldParentId = item._previousDataValues[foreignKey],
			oldLevel = item._previousDataValues[levelFieldName];

		if (
			(oldParentId !== undefined && parentId === oldParentId)
			|| !inFields(foreignKey, options)
		) return;

		if (oldParentId === undefined || oldLevel === undefined) {
			const itemRecord = await model.findOne(addOptions({
				where: {[primaryKey]: itemId}
			}, options));
			oldParentId = itemRecord[foreignKey];
			oldLevel = itemRecord[levelFieldName];
		}

		if (parentId === oldParentId) return;

		let level;
		if (parentId === null) {
			level = 1;
		} else {
			if (parentId === itemId) throw new HierarchyError('Parent cannot be a child of itself');

			let parent = options[PARENT];
			if (!parent) {
				parent = await model.findOne(
					addOptions({
						where: {[primaryKey]: parentId}, attributes: [levelFieldName, foreignKey]
					}, options)
				);
				if (!parent) throw new HierarchyError('Parent does not exist');
			}

			level = parent[levelFieldName] + 1;

			let illegal;
			if (parent[foreignKey] === itemId) {
				illegal = true;
			} else if (level > oldLevel + 2) {
				illegal = await through.findOne(
					addOptions({where: {[throughKey]: parentId, [throughForeignKey]: itemId}}, options)
				);
			}
			if (illegal) throw new HierarchyError('Parent cannot be a descendent of itself');
		}

		if (level !== oldLevel) {
			values[levelFieldName] = level;
			addToFields(levelFieldName, options);

			let sql = removeSpacing(`
                UPDATE *item
                SET *level = *level + :levelChange
                WHERE *id IN (
                    SELECT *itemId
                    FROM *through AS ancestors
                    WHERE ancestors.*ancestorId = :id
                )
            `);
			sql = replaceTableNames(sql, {item: model, through}, sequelize);
			sql = replaceFieldNames(sql, {level: levelFieldName, id: primaryKey}, model);
			sql = replaceFieldNames(sql, {itemId: throughKey, ancestorId: throughForeignKey}, through);

			await sequelize.query(
				sql,
				addOptions({replacements: {id: itemId, levelChange: level - oldLevel}}, options)
			);
		}

		if (oldParentId !== null) {
			let sql = removeSpacing(`
				WITH to_delete AS (
					SELECT d.*itemId, d.*ancestorId
					FROM *through d
					INNER JOIN *through descs ON descs.*itemId = d.*itemId
					INNER JOIN *through anc ON anc.*ancestorId = d.*ancestorId
				WHERE anc.*itemId = :id
				  AND (
					descs.*ancestorId = :id
				   OR descs.*itemId = :id
					)
					)
				DELETE FROM *through
				WHERE (*itemId, *ancestorId) IN (
					SELECT *itemId, *ancestorId FROM to_delete
				)
			`);
			sql = replaceTableNames(sql, {through}, sequelize);
			sql = replaceFieldNames(sql, {itemId: throughKey, ancestorId: throughForeignKey}, through);

			await sequelize.query(
				sql,
				addOptions({replacements: {id: itemId}}, options)
			);
		}

		if (parentId !== null) {
			let sql = removeSpacing(`
                INSERT INTO *through (*itemId, *ancestorId)
                SELECT descendents.*itemId, ancestors.*ancestorId
                FROM (
                    SELECT *itemId
                    FROM *through
                    WHERE *ancestorId = :id
                    UNION ALL
                    SELECT :id
                ) AS descendents,
                (
                    SELECT *ancestorId
                    FROM *through
                    WHERE *itemId = :parentId
                    UNION ALL
                    SELECT :parentId
                ) AS ancestors
            `);
			sql = replaceTableNames(sql, {through}, sequelize);
			sql = replaceFieldNames(sql, {itemId: throughKey, ancestorId: throughForeignKey}, through);

			await sequelize.query(
				sql,
				addOptions({replacements: {id: itemId, parentId}}, options)
			);
		}
	}

	function beforeBulkCreate(daos, options) {
		options.individualHooks = true;
	}

	async function beforeBulkUpdate(options) {
		const model = this,
			{primaryKey, foreignKey, levelFieldName} = model.hierarchy;

		if (!inFields(foreignKey, options)) return;

		const items = await model.findAll(addOptions({
			where: options.where,
			attributes: [primaryKey, foreignKey, levelFieldName]
		}, options));

		const {attributes} = options,
			parentId = attributes[foreignKey];
		let level;
		if (parentId === null) {
			level = 1;
		} else {
			const parent = await model.findOne(
				addOptions({
					where: {[primaryKey]: parentId}, attributes: [levelFieldName, foreignKey]
				}, options)
			);
			if (!parent) throw new HierarchyError('Parent does not exist');

			level = parent[levelFieldName] + 1;
			options[PARENT] = parent;
		}

		attributes[levelFieldName] = level;
		addToFields(levelFieldName, options);

		options = Object.assign({}, options);
		delete options.where;
		delete options.attributes;

		for (const item of items) {
			Object.assign(item, attributes);
			await beforeUpdate.call(model, item, options);
		}
	}
};
