const SequelizeAdapter = require("../../src");
const { ServiceBroker } = require("moleculer");
const Sequelize = require("sequelize");

jest.genMockFromModule("sequelize");
jest.mock("sequelize");

describe("Test SequelizeAdapter", () => {
	let broker, service, adapter;

	const initAdapter = (model, options) => {
		broker = new ServiceBroker({ logger: false });

		service = broker.createService({
			name: "store",
			model: model
		});

		adapter = new SequelizeAdapter(options);
		adapter.init(broker, service);
	};

	describe("constructor with options", () => {
		it("assigns opts property", () => {
			adapter = new SequelizeAdapter("example", "options");
			expect(adapter.opts).toEqual(["example", "options"]);
		});
	});

	describe("init", () => {
		describe("for a service without a model", () => {
			it("requires a model definition", () => {
				expect(() => initAdapter(null)).toThrowError("Missing `model` definition in schema of service!");
			});
		});

		describe("for a service with model definition", () => {
			it("assigns the service & broker propsserties", () => {
				const model = { name: "posts" };
				expect(() => initAdapter(model)).not.toThrowError();
				expect(adapter.broker).toBe(broker);
				expect(adapter.service).toBe(service);
			});
		});
	});

	describe("connect", () => {
		let db;

		beforeEach(() => {
			db = {
				authenticate: jest.fn().mockResolvedValue(),
				isDefined: jest.fn(() => false),
				define: jest.fn(),
				close: jest.fn().mockResolvedValue()
			};

			Sequelize.mockImplementation(() => db);
			Sequelize.mockClear();
		});

		describe("for an isolated Sequelize instance and model definition", () => {
			const postSchema = {
				name: "post",
				define: {
					title: Sequelize.STRING,
					content: Sequelize.TEXT,
				},
			};

			const options = {
				dialect: "sqlite"
			};

			let postModel;

			beforeEach(() => {
				postModel = {
					sync: jest.fn().mockResolvedValue()
				};

				db.isDefined = jest.fn(() => false);
				db.define = jest.fn(() => postModel);

				initAdapter(postSchema, options);

				return adapter.connect();
			});

			it("creates a new Sequelize instance with options", () => {
				expect(Sequelize).toHaveBeenCalledTimes(1);
				expect(Sequelize).toHaveBeenCalledWith(options);
				expect(adapter.db).toBe(db);
			});

			it("defines and assigns the model", () => {
				expect(adapter.db.define).toHaveBeenCalledWith(postSchema.name, postSchema.define, postSchema.options);
				expect(postModel.sync).toHaveBeenCalledTimes(1);
				expect(adapter.model).toBe(postModel);
				expect(service.model).toBe(postModel);
			});

			describe("disconnect", () => {
				beforeEach(() => adapter.disconnect());
				it("does close the connection", () => {
					expect(adapter.db.close).toHaveBeenCalledTimes(1);
				});
			});
		});

		describe("for a shared Sequelize instance and model definition", () => {
			const postSchema = {
				name: "post",
			};

			let postModel;

			beforeEach(() => {
				postModel = {
					sync: jest.fn().mockResolvedValue()
				};

				db.isDefined = jest.fn(() => true);
				db.model = jest.fn(() => postModel);

				initAdapter(postSchema, db);

				return adapter.connect();
			});

			it("uses the existing Sequelize instance", () => {
				expect(Sequelize).not.toHaveBeenCalled();
				expect(adapter.db).toBe(db);
			});

			it("defines and assigns the model", () => {
				expect(adapter.db.define).not.toHaveBeenCalled();
				expect(postModel.sync).toHaveBeenCalledTimes(1);
				expect(adapter.model).toBe(postModel);
				expect(service.model).toBe(postModel);
			});

			describe("disconnect", () => {
				beforeEach(() => adapter.disconnect());
				it("does not close the connection", () => {
					expect(adapter.db.close).not.toHaveBeenCalled();
				});
			});
		});
	});

	describe("createCursor", () => {
		let models;

		beforeEach(() => {
			models = {};

			models.Country = { name: "country" };

			models.Author = {
				name: "author",
				associations: {
					country: models.Country
				}
			};

			models.Comment = {
				name: "comment"
			};

			models.Post = {
				name: "post",
				sync: jest.fn(() => Promise.resolve()),
				findAll: jest.fn(() => Promise.resolve()),
				count: jest.fn(() => Promise.resolve()),
				findOne: jest.fn(() => Promise.resolve()),
				findById: jest.fn(() => Promise.resolve()),
				create: jest.fn(() => Promise.resolve()),
				update: jest.fn(() => Promise.resolve([1, 2])),
				destroy: jest.fn(() => Promise.resolve()),

				associations: {
					author: models.Author,
					comments: models.Comment
				}
			};

			const db = {
				authenticate: jest.fn().mockResolvedValue(),
				isDefined: jest.fn(() => true),
				model: jest.fn(() => models.Post)
			};

			initAdapter(models.Post, db);
			return adapter.connect();
		});

		it("call without params", () => {
			adapter.createCursor();
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith();
		});

		it("call without params as counting", () => {
			adapter.createCursor(null, true);
			expect(adapter.model.count).toHaveBeenCalledTimes(1);
			expect(adapter.model.count).toHaveBeenCalledWith();
		});

		it("call with query", () => {
			let query = {};
			adapter.createCursor({ query });
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({ where: query });
		});

		it("call with query & counting", () => {
			let query = {};
			adapter.createCursor({ query }, true);
			expect(adapter.model.count).toHaveBeenCalledTimes(1);
			expect(adapter.model.count).toHaveBeenCalledWith({ where: query });
		});

		it("call with query referencing associations", () => {
			let query = { name: "Foo", "author.name": "Paul" };
			adapter.createCursor({ query });
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({
				where: {
					name: "Foo",
					"$author.name$": "Paul"
				},
				include: [
					{ association: models.Author }
				]
			});
		});

		it("call with sort string", () => {
			let query = {};
			adapter.createCursor({ query, sort: "-votes title author.name -author.country.name" });
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({
				where: query,
				order: [
					["votes", "DESC"],
					["title", "ASC"],
					[models.Author, "name", "ASC"],
					[models.Author, models.Country, "name", "DESC"]
				]
			});
		});

		it("call with sort array", () => {
			adapter.model.findAll.mockClear();
			let query = {};
			adapter.createCursor({ query, sort: ["createdAt", "title", "-author.name"] });
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({
				where: query,
				order: [
					["createdAt", "ASC"],
					["title", "ASC"],
					[models.Author, "name", "DESC"]
				]
			});
		});

		it("call with sort object", () => {
			adapter.model.findAll.mockClear();
			let query = {};
			adapter.createCursor({ query, sort: { createdAt: 1, title: -1, "author.name": -1 }});
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({
				where: query,
				order: [
					["createdAt", "ASC"],
					["title", "DESC"],
					[models.Author, "name", "DESC"]
				]
			});
		});

		it("call with limit & offset", () => {
			adapter.model.findAll.mockClear();
			adapter.createCursor({ limit: 5, offset: 10 });
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({
				offset: 10,
				limit: 5,
				where: {}
			});
		});

		it("call with full-text search", () => {
			adapter.model.findAll.mockClear();
			adapter.createCursor({ search: "walter", searchFields: ["title", "content"] });
			expect(adapter.model.findAll).toHaveBeenCalledTimes(1);
			expect(adapter.model.findAll).toHaveBeenCalledWith({
				where: {
					"$or": [
						{
							title: {
								"$like": "%walter%"
							}
						},
						{
							content: {
								"$like": "%walter%"
							}
						}
					]
				}
			});
		});

	});
});
