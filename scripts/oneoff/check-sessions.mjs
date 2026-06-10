import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const sessions = await p.session.findMany();
console.log('Sessions:', sessions.length);
sessions.forEach(s => console.log('  userId:', s.userId, 'expires:', s.expires));

const accounts = await p.account.findMany();
console.log('\nAccounts:', accounts.length);
accounts.forEach(a => console.log('  userId:', a.userId, 'provider:', a.provider));

const users = await p.user.findMany();
console.log('\nUsers:', users.length);
users.forEach(u => console.log('  id:', u.id, 'email:', u.email, 'role:', u.role));

await p.$disconnect();
