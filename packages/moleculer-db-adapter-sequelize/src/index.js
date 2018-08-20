/*
 * moleculer-db-adapter-sequelize
 * Copyright (c) 2017 MoleculerJS (https://github.com/moleculerjs/moleculer-db)
 * MIT Licensed
 */

"use strict";

const _ 		= require("lodash");
const Promise	= require("bluebird");
const Sequelize = require("sequelize");

class SequelizeDbAdapter {

	/**
	 * Creates an instance of SequelizeDbAdapter.
	 * @param {any} opts
	 *
	 * @memberof SequelizeDbAdapter
	 */
	constructor(...opts) {
		this.opts = opts;
	}

	/**
	 * Initialize adapter
	 *
	 * @param {ServiceBroker} broker
	 * @param {Service} service
	 *
	 * @memberof SequelizeDbAdapter
	 */
	init(broker, service) {
		this.broker = broker;
		this.service = service;

		if (!this.service.schema.model) {
			/* istanbul ignore next */
			throw new Error("Missing `model` definition in schema of service!");
		}
	}

	/**
	 * Connect to database
	 *
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	connect() {
		// Allow passing an existing Sequelize instance as options.
		if(this.opts.length === 1 && _.isFunction(this.opts[0].authenticate)) {
			this.db = this.opts[0];

			// Don't close connection for the shared instance on disconnect as other
			// services might still use it.
			this.closeOnDisconnect = false;
		} else {
			this.db = new Sequelize(...this.opts);
			this.closeOnDisconnect = true;
		}

		return this.db.authenticate().then(() => {
			let m = this.service.schema.model;

			if(this.db.isDefined(m.name)) {
				this.model = this.db.model(m.name);
			} else {
				this.model = this.db.define(m.name, m.define, m.options);
			}

			this.service.model = this.model;

			return this.model.sync();
		});
	}

	/**
	 * Disconnect from database
	 *
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	disconnect() {
		if (this.db && this.closeOnDisconnect) {
			return this.db.close();
		}
		return Promise.resolve();
	}

	/**
	 * Find all entities by filters.
	 *
	 * Available filter props:
	 * 	- limit
	 *  - offset
	 *  - sort
	 *  - search
	 *  - searchFields
	 *  - query
	 *
	 * @param {any} filters
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	find(filters) {
		return this.createCursor(filters);
	}

	/**
	 * Find an entity by query
	 *
	 * @param {Object} query
	 * @returns {Promise}
	 * @memberof MemoryDbAdapter
	 */
	findOne(query) {
		return this.model.findOne(query);
	}

	/**
	 * Find an entities by ID
	 *
	 * @param {any} _id
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	findById(_id) {
		return this.model.findById(_id);
	}

	/**
	 * Find any entities by IDs
	 *
	 * @param {Array} idList
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	findByIds(idList) {
		return this.model.findAll({
			where: {
				id:  idList
			}
		});
	}

	/**
	 * Get count of filtered entites
	 *
	 * Available filter props:
	 *  - search
	 *  - searchFields
	 *  - query
	 *
	 * @param {Object} [filters={}]
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	count(filters = {}) {
		return this.createCursor(filters, true);
	}

	/**
	 * Insert an entity
	 *
	 * @param {Object} entity
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	insert(entity) {
		return this.model.create(entity);
	}

	/**
	 * Insert many entities
	 *
	 * @param {Array} entities
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	insertMany(entities) {
		const p = entities.map(e => this.model.create(e));
		return Promise.all(p);
	}

	/**
	 * Update many entities by `where` and `update`
	 *
	 * @param {Object} where
	 * @param {Object} update
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	updateMany(where, update) {
		return this.model.update(update, { where }).then(res => res[0]);
	}

	/**
	 * Update an entity by ID and `update`
	 *
	 * @param {any} _id
	 * @param {Object} update
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	updateById(_id, update) {
		return this.findById(_id).then(entity => {
			return entity.update(update["$set"]);
		});
	}

	/**
	 * Remove entities which are matched by `where`
	 *
	 * @param {Object} where
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	removeMany(where) {
		return this.model.destroy({ where });
	}

	/**
	 * Remove an entity by ID
	 *
	 * @param {any} _id
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	removeById(_id) {
		return this.findById(_id).then(entity => {
			return entity.destroy().then(() => entity);
		});
	}

	/**
	 * Clear all entities from collection
	 *
	 * @returns {Promise}
	 *
	 * @memberof SequelizeDbAdapter
	 */
	clear() {
		return this.model.destroy({ where: {} });
	}

	/**
	 * Convert DB entity to JSON object
	 *
	 * @param {any} entity
	 * @returns {Object}
	 * @memberof SequelizeDbAdapter
	 */
	entityToObject(entity) {
		return entity.get({ plain: true });
	}

	/**
	 * Create a filtered query
	 * Available filters in `params`:
	 *  - search
	 * 	- sort
	 * 	- limit
	 * 	- offset
	 *  - query
	 *
 	 * @param {Object} params
 	 * @param {Boolean} isCounting
	 * @returns {Promise}
	 */
	createCursor(params, isCounting) {
		if (params) {
			const q = {
				where: params.query || {}
			};

			// Text search
			if (_.isString(params.search) && params.search !== "") {
				let fields = [];
				if (params.searchFields) {
					fields = _.isString(params.searchFields) ? params.searchFields.split(" ") : params.searchFields;
				}

				q.where = {
					$or: fields.map(f => {
						return {
							[f]: {
								$like: "%" + params.search + "%"
							}
						};
					})
				};
			}

			// Sort
			if (params.sort) {
				let sort = this.transformSort(params.sort);
				if (sort)
					q.order = sort;
			}

			// Offset
			if (_.isNumber(params.offset) && params.offset > 0)
				q.offset = params.offset;

			// Limit
			if (_.isNumber(params.limit) && params.limit > 0)
				q.limit = params.limit;

			if (isCounting)
				return this.model.count(q);
			else
				return this.model.findAll(q);
		}

		if (isCounting)
			return this.model.count();
		else
			return this.model.findAll();
	}

	/**
	 * Convert the `sort` param to a `sort` object to Mongo queries.
	 *
	 * @param {String|Array<String>|Object} paramSort
	 * @returns {Object} Return with a sort object like `[["votes", "ASC"], ["title", "DESC"]]`
	 * @memberof MongoDbAdapter
	 */
	transformSort(paramSort) {
		let sort = paramSort;
		if (_.isString(sort))
			sort = sort.replace(/,/, " ").split(" ");

		if (Array.isArray(sort)) {
			let sortObj = [];
			sort.forEach(s => {
				if (s.startsWith("-"))
					sortObj.push([s.slice(1), "DESC"]);
				else
					sortObj.push([s, "ASC"]);
			});
			return sortObj;
		}

		if (_.isObject(sort)) {
			return Object.keys(sort).map(name => [name, sort[name] > 0 ? "ASC" : "DESC"]);
		}

		/* istanbul ignore next*/
		return [];
	}

}

module.exports = SequelizeDbAdapter;
