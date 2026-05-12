import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { UserStore } from '../store/db';
import { signToken, verifyToken } from '../middleware/auth';

export function authRouter(userStore: UserStore): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    const { email, password, role, name } = req.body;
    if (!email || !password || !role || !name) {
      res.status(400).json({ error: 'email, password, role, and name are required' }); return;
    }
    if (!['driver', 'passenger'].includes(role)) {
      res.status(400).json({ error: 'role must be driver or passenger' }); return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 characters' }); return;
    }
    if (await userStore.findByEmail(email)) {
      res.status(409).json({ error: 'email_already_registered' }); return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = randomUUID();
    await userStore.insert({ userId, email, passwordHash, role, name });
    const token = signToken({ userId, role });
    res.status(201).json({ token, userId, role, name });
  });

  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' }); return;
    }
    const user = await userStore.findByEmail(email);
    if (!user) { res.status(401).json({ error: 'invalid_credentials' }); return; }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: 'invalid_credentials' }); return; }
    const token = signToken({ userId: user.userId, role: user.role });
    res.status(200).json({ token, userId: user.userId, role: user.role, name: user.name });
  });

  router.get('/me', async (req: Request, res: Response) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing_token' }); return;
    }
    try {
      const payload = verifyToken(header.slice(7));
      const user = await userStore.findById(payload.userId);
      if (!user) { res.status(404).json({ error: 'user_not_found' }); return; }
      res.json({ userId: user.userId, role: user.role, name: user.name, email: user.email });
    } catch {
      res.status(401).json({ error: 'invalid_token' });
    }
  });

  return router;
}
