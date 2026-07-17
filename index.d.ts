import { DataType, Transaction, Model, ModelStatic } from 'sequelize';

export interface HierarchyOptions {
	as?: string;
	childrenAs?: string;
	ancestorsAs?: string;
	descendentsAs?: string;
	primaryKey?: string;
	foreignKey?: string;
	foreignKeyAttributes?: object;
	levelFieldName?: string;
	levelFieldType?: DataType;
	levelFieldAttributes?: object;
	throughKey?: string;
	throughForeignKey?: string;
	through?: string;
	throughTable?: string;
	throughSchema?: string;
	freezeTableName?: boolean;
	camelThrough?: boolean;
	onDelete?: 'RESTRICT' | 'CASCADE';
	labels?: boolean;
}

export interface HierarchyDefinition {
	primaryKey: string;
	foreignKey: string;
	levelFieldName: string;
	childrenAs: string;
	ancestorsAs: string;
	descendentsAs: string;
	throughKey: string;
	throughForeignKey: string;
	through: ModelStatic<Model>;
}

export interface QueryOptions {
	transaction?: Transaction;
	logging?: boolean | ((sql: string) => void);
}

export declare class HierarchyError extends Error {
	constructor(message: string);
	name: 'SequelizeHierarchyError';
}

export type HierarchyModel<M extends Model> = ModelStatic<M> & {
	isHierarchy(options?: HierarchyOptions): HierarchyModel<M>;
	rebuildHierarchy(options?: QueryOptions): Promise<HierarchyModel<M>>;
	hierarchy: HierarchyDefinition;
};

export type SequelizeWithHierarchy = typeof import('sequelize') & {
	HierarchyError: typeof HierarchyError;
};

declare function sequelizeHierarchy(
	Sequelize: typeof import('sequelize')
): SequelizeWithHierarchy;

export default sequelizeHierarchy;
