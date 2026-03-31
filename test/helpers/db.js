'use strict';

const {Sequelize} = require('sequelize');
require('../../index')(Sequelize);

const sequelize = new Sequelize({
	dialect: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: process.env.DB_PORT || 5431,
	database: process.env.DB_NAME || 'hierarchy_test',
	username: process.env.DB_USER || 'test',
	password: process.env.DB_PASS || 'test',
	logging: console.log
});

async function connect() {
	await sequelize.authenticate();
}

async function sync() {
	await sequelize.sync({force: true});
}

async function disconnect() {
	await sequelize.close();
}

module.exports = {sequelize, connect, sync, disconnect};
