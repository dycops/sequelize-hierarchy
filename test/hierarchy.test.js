'use strict';

const {connect, sync, disconnect} = require('./helpers/db');
const {Category} = require('./helpers/models');

beforeAll(async () => {
	await connect();
	await sync();
});

afterAll(async () => {
	await disconnect();
});

beforeEach(async () => {
	await Category.destroy({truncate: true, cascade: true});
});

// -------------------------------------------------------
// isHierarchy
// -------------------------------------------------------
describe('isHierarchy', () => {
	test('модель имеет hierarchy объект после инициализации', () => {
		expect(Category.hierarchy).toBeDefined();
		expect(Category.hierarchy.primaryKey).toBe('id');
		expect(Category.hierarchy.foreignKey).toBe('parentId');
		expect(Category.hierarchy.levelFieldName).toBe('hierarchyLevel');
	});

	test('создаётся through таблица', () => {
		expect(Category.hierarchy.through).toBeDefined();
		expect(Category.hierarchy.through.tableName).toBe('Categoriesancestors');
	});

	test('модель имеет ассоциации children и parent', () => {
		expect(Category.associations.children).toBeDefined();
		expect(Category.associations.parent).toBeDefined();
	});

	test('модель имеет ассоциации ancestors и descendents', () => {
		expect(Category.associations.ancestors).toBeDefined();
		expect(Category.associations.descendents).toBeDefined();
	});
});

// -------------------------------------------------------
// beforeCreate / afterCreate
// -------------------------------------------------------
describe('создание узлов', () => {
	test('корневой узел получает level 1', async () => {
		const root = await Category.create({name: 'Root'});
		expect(root.hierarchyLevel).toBe(1);
	});

	test('дочерний узел получает level 2', async () => {
		const root = await Category.create({name: 'Root'});
		const child = await Category.create({name: 'Child', parentId: root.id});
		expect(child.hierarchyLevel).toBe(2);
	});

	test('вложенный узел получает корректный level', async () => {
		const root = await Category.create({name: 'Root'});
		const child = await Category.create({name: 'Child', parentId: root.id});
		const grandchild = await Category.create({name: 'Grandchild', parentId: child.id});
		expect(grandchild.hierarchyLevel).toBe(3);
	});

	test('создаются записи в through таблице', async () => {
		const root = await Category.create({name: 'Root'});
		const child = await Category.create({name: 'Child', parentId: root.id});
		const grandchild = await Category.create({name: 'Grandchild', parentId: child.id});

		const {through, throughKey, throughForeignKey} = Category.hierarchy;

		const ancestors = await through.findAll({
			where: {[throughKey]: grandchild.id}
		});

		const ancestorIds = ancestors.map(a => a[throughForeignKey]);
		expect(ancestorIds).toContain(root.id);
		expect(ancestorIds).toContain(child.id);
	});

	test('нельзя создать узел с несуществующим родителем', async () => {
		await expect(
			Category.create({name: 'Child', parentId: 99999})
		).rejects.toThrow('Parent does not exist');
	});

	test('нельзя сделать узел дочерним самому себе', async () => {
		const root = await Category.create({name: 'Root'});
		await expect(
			Category.create({name: 'Self', id: root.id, parentId: root.id})
		).rejects.toThrow('Parent cannot be a child of itself');
	});
});

// -------------------------------------------------------
// beforeUpdate — reparent
// -------------------------------------------------------
describe('перемещение узлов (reparent)', () => {
	test('перемещение узла обновляет level', async () => {
		const root1 = await Category.create({name: 'Root1'});
		const root2 = await Category.create({name: 'Root2'});
		const child = await Category.create({name: 'Child', parentId: root1.id});

		await child.update({parentId: root2.id});
		await child.reload();

		expect(child.hierarchyLevel).toBe(2);
	});

	test('перемещение в корень обновляет level на 1', async () => {
		const root = await Category.create({name: 'Root'});
		const child = await Category.create({name: 'Child', parentId: root.id});

		await child.update({parentId: null});
		await child.reload();

		expect(child.hierarchyLevel).toBe(1);
	});

	test('перемещение обновляет through таблицу', async () => {
		const root1 = await Category.create({name: 'Root1'});
		const root2 = await Category.create({name: 'Root2'});
		const child = await Category.create({name: 'Child', parentId: root1.id});

		await child.update({parentId: root2.id});

		const {through, throughKey, throughForeignKey} = Category.hierarchy;
		const ancestors = await through.findAll({
			where: {[throughKey]: child.id}
		});

		const ancestorIds = ancestors.map(a => a[throughForeignKey]);
		expect(ancestorIds).toContain(root2.id);
		expect(ancestorIds).not.toContain(root1.id);
	});

	test('нельзя переместить узел в своего потомка', async () => {
		const root = await Category.create({name: 'Root'});
		const child = await Category.create({name: 'Child', parentId: root.id});

		await expect(
			root.update({parentId: child.id})
		).rejects.toThrow('Parent cannot be a descendent of itself');
	});

	test('нельзя сделать узел дочерним самому себе при update', async () => {
		const root = await Category.create({name: 'Root'});

		await expect(
			root.update({parentId: root.id})
		).rejects.toThrow('Parent cannot be a child of itself');
	});
});

// -------------------------------------------------------
// afterFind — построение дерева
// -------------------------------------------------------
describe('получение дерева', () => {
	test('findAll с hierarchy возвращает вложенную структуру', async () => {
		const root = await Category.create({name: 'Root'});
		const child1 = await Category.create({name: 'Child1', parentId: root.id});
		const child2 = await Category.create({name: 'Child2', parentId: root.id});
		await Category.create({name: 'Grandchild', parentId: child1.id});

		const result = await Category.findAll({hierarchy: true});

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('Root');
		expect(result[0].children).toHaveLength(2);
		expect(result[0].children[0].children).toHaveLength(1);
	});
});

// -------------------------------------------------------
// rebuildHierarchy
// -------------------------------------------------------
describe('rebuildHierarchy', () => {
	test('перестраивает through таблицу корректно', async () => {
		const root = await Category.create({name: 'Root'});
		const child = await Category.create({name: 'Child', parentId: root.id});
		const grandchild = await Category.create({name: 'Grandchild', parentId: child.id});

		// Очищаем through таблицу вручную
		const {through} = Category.hierarchy;
		await through.destroy({truncate: true});

		// Перестраиваем
		await Category.rebuildHierarchy();

		const ancestors = await through.findAll({
			where: {[Category.hierarchy.throughKey]: grandchild.id}
		});

		expect(ancestors).toHaveLength(2);
	});
});
