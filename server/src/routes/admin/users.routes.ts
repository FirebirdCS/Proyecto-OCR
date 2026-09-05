import { Router } from 'express';
import { z } from 'zod';
import {
  createUserAccount,
  listUsers,
  resendInvite,
  setUserDisabled,
  setUserRole,
} from '../../services/users.service.js';
import { ROLES } from '../../types/roles.js';

export const adminUsersRouter = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  pageToken: z.string().optional(),
});

/** GET /api/admin/users */
adminUsersRouter.get('/', async (req, res, next) => {
  try {
    const { limit, pageToken } = listQuery.parse(req.query);
    res.json(await listUsers(limit, pageToken));
  } catch (error) {
    next(error);
  }
});

const createBody = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).default('user'),
});

/** POST /api/admin/users creates the account and emails the invite. */
adminUsersRouter.post('/', async (req, res, next) => {
  try {
    const input = createBody.parse(req.body);
    res.status(201).json(await createUserAccount(input, req.user!.uid));
  } catch (error) {
    next(error);
  }
});

/** POST /api/admin/users/:uid/invite re-sends the set-password link. */
adminUsersRouter.post('/:uid/invite', async (req, res, next) => {
  try {
    res.json(await resendInvite(req.params.uid!));
  } catch (error) {
    next(error);
  }
});

const roleBody = z.object({ role: z.enum(ROLES) });

/** PATCH /api/admin/users/:uid/role */
adminUsersRouter.patch('/:uid/role', async (req, res, next) => {
  try {
    const { role } = roleBody.parse(req.body);
    res.json(await setUserRole(req.params.uid!, role, req.user!.uid));
  } catch (error) {
    next(error);
  }
});

const disabledBody = z.object({ disabled: z.boolean() });

/** PATCH /api/admin/users/:uid/disabled blocks or restores sign-in. */
adminUsersRouter.patch('/:uid/disabled', async (req, res, next) => {
  try {
    const { disabled } = disabledBody.parse(req.body);
    res.json(await setUserDisabled(req.params.uid!, disabled, req.user!.uid));
  } catch (error) {
    next(error);
  }
});
