'use strict';

const {DataTypes} = require('sequelize');
const {sequelize} = require('./db');

const Category = sequelize.define('Category', {
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	},
	name: {
		type: DataTypes.STRING,
		allowNull: false
	},
	parentId: {
		type: DataTypes.INTEGER,
		hierarchy: true
	}
});

module.exports = {Category};
