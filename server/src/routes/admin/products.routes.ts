import { Router } from 'express';
import {
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
} from '../../services/products.service.js';
import { productInputSchema } from '../../types/campaigns.js';

export const adminProductsRouter = Router();

/** GET /api/admin/products */
adminProductsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ products: await listProducts() });
  } catch (error) {
    next(error);
  }
});

/** POST /api/admin/products takes a name and what one unit is worth. */
adminProductsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createProduct(productInputSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/admin/products/:id */
adminProductsRouter.patch('/:id', async (req, res, next) => {
  try {
    const input = productInputSchema.partial().parse(req.body);
    res.json(await updateProduct(req.params.id!, input));
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/admin/products/:id is refused while a live campaign uses it. */
adminProductsRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteProduct(req.params.id!);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
