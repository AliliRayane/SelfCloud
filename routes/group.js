import { Router } from 'express';
import { authenticate, admin } from '../middleware/auth.js';
import * as group from '../controller/group.js';

export const groupRoutes = Router();
groupRoutes.use(authenticate);
groupRoutes.get('/groups', group.list);
groupRoutes.get('/admin/groups', admin, group.adminList);
groupRoutes.post('/admin/groups', admin, group.create);
groupRoutes.put('/admin/groups/:id/members', admin, group.membership);
groupRoutes.delete('/admin/groups/:id', admin, group.remove);
groupRoutes.put('/groups/:id/files/:file', group.share);
groupRoutes.delete('/groups/:id/files/:file', group.unshare);
