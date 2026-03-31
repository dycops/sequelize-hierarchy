'use strict';

module.exports = {
	removeSpacing,
	replaceFieldNames,
	replaceTableNames,
	humanize,
	addOptions,
	inFields,
	valueFilteredByFields,
	addToFields
};

// Remove spacing from SQL
function removeSpacing(sql) {
	return sql.replace(/[ \t\r\n]+/g, ' ').trim();
}

// Replace field names in SQL marked with * with the identifier text quoted.
// e.g. SELECT *field FROM `Tasks` with identifiers {field: 'name'}
// -> SELECT `name` FROM `Tasks`
function replaceFieldNames(sql, identifiers, model) {
	const {queryInterface} = model.sequelize;
	for (let [identifier, fieldName] of Object.entries(identifiers)) {
		fieldName = model.getAttributes()[fieldName].field;
		sql = sql.replace(
			new RegExp(`\\*${identifier}(?![a-zA-Z0-9_])`, 'g'),
			queryInterface.quoteIdentifier(fieldName)
		);
	}
	return sql;
}

// Replace identifier with model's full table name taking schema into account
function replaceTableNames(sql, identifiers, sequelize) {
	const {queryInterface} = sequelize;
	for (const [identifier, model] of Object.entries(identifiers)) {
		const tableName = model.getTableName();
		sql = sql.replace(
			new RegExp(`\\*${identifier}(?![a-zA-Z0-9_])`, 'g'),
			tableName.schema
				? tableName.toString()
				: queryInterface.quoteIdentifier(tableName)
		);
	}
	return sql;
}

// String format conversion from camelCase or underscored format to human-readable format
// e.g. 'fooBar' -> 'Foo Bar', 'foo_bar' -> 'Foo Bar'
function humanize(str) {
	if (str == null || str === '') return '';
	str = `${str}`.replace(
		/[-_\s]+(.)?/g,
		(match, c) => (c ? c.toUpperCase() : '')
	);
	return str[0].toUpperCase() + str.slice(1).replace(/([A-Z])/g, ' $1');
}

// Add transaction and logging from options to query options
function addOptions(queryOptions, options) {
	const {transaction, logging} = options;
	if (transaction !== undefined) queryOptions.transaction = transaction;
	if (logging !== undefined) queryOptions.logging = logging;
	return queryOptions;
}

// Check if field is in `fields` option
function inFields(fieldName, options) {
	const {fields} = options;
	if (!fields) return true;
	return fields.includes(fieldName);
}

// Get field value if is included in `options.fields`
function valueFilteredByFields(fieldName, item, options) {
	if (!inFields(fieldName, options)) return null;
	return item.dataValues[fieldName];
}

// Add a field to `options.fields`.
// NB Clones `options.fields` before adding to it, to avoid options being mutated externally.
function addToFields(fieldName, options) {
	if (inFields(fieldName, options)) return;
	options.fields = options.fields.concat([fieldName]);
}
