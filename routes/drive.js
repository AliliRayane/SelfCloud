import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as drive from '../controller/drive.js';

export const driveRoutes = Router();
driveRoutes.use(authenticate);
driveRoutes.get('/files', drive.list);
driveRoutes.post('/files', drive.upload);
driveRoutes.get('/files/:id', drive.details);
driveRoutes.get('/files/:id/download', drive.download);
driveRoutes.get('/files/:id/preview', drive.preview);
driveRoutes.patch('/files/:id', drive.update);
driveRoutes.post('/files/:id/trash', drive.trash);
driveRoutes.post('/files/:id/restore', drive.restore);
driveRoutes.delete('/files/:id', drive.remove);
driveRoutes.get('/folders', drive.folderTree);
driveRoutes.post('/folders', drive.addFolder);
driveRoutes.patch('/folders/:id', drive.updateFolder);
driveRoutes.delete('/folders/:id', drive.removeFolder);
