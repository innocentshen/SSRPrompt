import { Router, type IRouter } from 'express';
import { providersController } from '../controllers/index.js';
import { modelsController } from '../controllers/index.js';

const router: IRouter = Router();

/**
 * @swagger
 * /providers:
 *   get:
 *     tags: [Providers]
 *     summary: 获取服务商列表
 *     responses:
 *       200:
 *         description: 成功
 *   post:
 *     tags: [Providers]
 *     summary: 创建服务商
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               baseUrl:
 *                 type: string
 *               apiKey:
 *                 type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.get('/', (req, res, next) => providersController.list(req, res, next));
router.post('/', (req, res, next) => providersController.create(req, res, next));

/**
 * @swagger
 * /providers/test-connection:
 *   post:
 *     tags: [Providers]
 *     summary: 测试服务商连接
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *               apiKey:
 *                 type: string
 *               baseUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: 测试结果
 */
router.post('/test-connection', (req, res, next) => providersController.testConnection(req, res, next));

/**
 * @swagger
 * /providers/{id}:
 *   get:
 *     tags: [Providers]
 *     summary: 获取服务商详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *   put:
 *     tags: [Providers]
 *     summary: 更新服务商
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *   delete:
 *     tags: [Providers]
 *     summary: 删除服务商
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: 删除成功
 */
router.get('/:id', (req, res, next) => providersController.getById(req, res, next));
router.put('/:id', (req, res, next) => providersController.update(req, res, next));
router.delete('/:id', (req, res, next) => providersController.delete(req, res, next));

/**
 * @swagger
 * /providers/{providerId}/models:
 *   get:
 *     tags: [Models]
 *     summary: 获取服务商下的模型列表
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *   post:
 *     tags: [Models]
 *     summary: 创建模型
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 创建成功
 */
router.get('/:providerId/models', (req, res, next) => modelsController.listByProvider(req, res, next));
router.post('/:providerId/models', (req, res, next) => modelsController.create(req, res, next));
router.post('/:providerId/models/discover', (req, res, next) => providersController.discoverModels(req, res, next));

export default router;
