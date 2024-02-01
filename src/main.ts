import fs from 'fs';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';

import { Bot } from './bot';
import { Account, AccountStatus } from './interfaces/account.interface';
import { Config } from './interfaces/config.interface';
import { Logger } from './logger';

const configFilePath = path.resolve(process.cwd(), './config.json');
if (!fs.existsSync(configFilePath)) fs.writeFileSync(configFilePath, JSON.stringify(getDefaultConfig(), null, 2));

const farmsDirectoryPath = path.resolve(process.cwd(), './farms');
if (!fs.existsSync(farmsDirectoryPath)) fs.mkdirSync(farmsDirectoryPath, { recursive: true });

const proxiesFilePath = path.resolve(process.cwd(), './proxies.txt');
if (!fs.existsSync(proxiesFilePath)) fs.writeFileSync(proxiesFilePath, '');

const cleanedDirectoryPath = path.resolve(process.cwd(), './cleaned');
if (!fs.existsSync(cleanedDirectoryPath)) fs.mkdirSync(cleanedDirectoryPath, { recursive: true });

main();

async function main() {
  const logger = new Logger('main');
  const config = readConfig();

  const accounts = readAccounts();
  logger.info(`Accounts: ${accounts.length}`);

  const proxies = readProxies();
  logger.info(`Proxies: ${proxies.length}`);

  const concurrency = proxies.length || 1;
  logger.info(`Concurrency: ${concurrency}`);

  const queue = new PQueue({ concurrency, interval: 30000, intervalCap: concurrency });

  let index = 0;
  for (const account of accounts) {
    const proxy = proxies[index++ % proxies.length];
    const bot = new Bot(account, proxy);

    const task = () => pRetry(() => bot.start(), { retries: 3, minTimeout: 30000, maxTimeout: 30000 });

    queue
      .add(task)
      .then(() => {
        if (bot.bans.length > 0) account.status = AccountStatus.Banned;
        else if (bot.level === 0) account.status = AccountStatus.Limited;
        else account.status = AccountStatus.Active;

        logger.info(`Account processed '${account.username}' (${account.status})`);
      })
      .catch((error) => {
        account.status = AccountStatus.Unknown;

        logger.error(`Failed to process account '${account.username}' (${error.message})`);
      })
      .finally(() => {
        bot.stop();

        if (account.status === AccountStatus.Active) return;
        if (account.status === AccountStatus.Banned && !config.CleanBannedAccounts) return;
        if (account.status === AccountStatus.Limited && !config.CleanLimitedAccounts) return;

        cleanAccount(account);
      });
  }

  await queue.onIdle();

  logger.info('-'.repeat(40));
  logger.info('All accounts processed');

  await delay(10000);
}

function readProxies() {
  try {
    const fileContent = fs.readFileSync(proxiesFilePath, 'utf-8');

    const proxies = fileContent
      .split('\n')
      .map((proxy) => proxy.trim())
      .filter((proxy) => proxy);

    return [...new Set(proxies)];
  } catch (error) {
    return [];
  }
}

function readAccounts() {
  const filePaths = readDirectory(farmsDirectoryPath).filter((f) => f.endsWith('.json'));

  const accounts: Account[] = [];

  for (const jsonPath of filePaths) {
    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    const json = JSON.parse(fileContent);

    if (!json || !json.SteamLogin || !json.SteamPassword) continue;

    const account: Account = {
      id: jsonPath.replace('.json', ''),
      status: AccountStatus.Active,

      username: json.SteamLogin,
      password: json.SteamPassword,
      secret: null,
    };

    if (fs.existsSync(account.id + '.db')) {
      const fileContent = fs.readFileSync(account.id + '.db', 'utf-8');
      const db = JSON.parse(fileContent);

      if (db?._MobileAuthenticator?.shared_secret) account.secret = db._MobileAuthenticator.shared_secret;
    }

    if (!account.secret && fs.existsSync(account.id + '.mafile')) {
      const fileContent = fs.readFileSync(account.id + '.mafile', 'utf-8');
      const mafile = JSON.parse(fileContent);

      if (mafile?.shared_secret) account.secret = mafile.shared_secret;
    }

    if (!account.secret && fs.existsSync(account.id + '.maFile')) {
      const fileContent = fs.readFileSync(account.id + '.maFile', 'utf-8');
      const mafile = JSON.parse(fileContent);

      if (mafile?.shared_secret) account.secret = mafile.shared_secret;
    }

    accounts.push(account);
  }

  return accounts;
}

function readDirectory(entityPath: string): string[] {
  if (!entityPath || !fs.existsSync(entityPath)) return [];

  const entities = fs.readdirSync(entityPath).map((entity) => path.join(entityPath, entity));
  const filePaths: string[] = [];

  for (const entity of entities) {
    if (fs.statSync(entity).isDirectory()) filePaths.push(...readDirectory(entity));
    else filePaths.push(entity);
  }

  return filePaths;
}

function readConfig(): Config {
  try {
    const fileContent = fs.readFileSync(configFilePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    return getDefaultConfig();
  }
}

function getDefaultConfig(): Config {
  return {
    CleanLimitedAccounts: true,
    CleanBannedAccounts: true,
  };
}

function cleanAccount(account: Account) {
  const directoryPath = path.resolve(cleanedDirectoryPath, account.status);
  if (!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath, { recursive: true });

  const jsonPath = account.id + '.json';
  fs.renameSync(jsonPath, path.resolve(directoryPath, path.basename(jsonPath)));

  const dbPath = account.id + '.db';
  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, path.resolve(directoryPath, path.basename(dbPath)));

  const mafilePath = account.id + '.mafile';
  if (fs.existsSync(mafilePath)) fs.renameSync(mafilePath, path.resolve(directoryPath, path.basename(mafilePath)));

  const maFilePath = account.id + '.maFile';
  if (fs.existsSync(maFilePath)) fs.renameSync(maFilePath, path.resolve(directoryPath, path.basename(maFilePath)));

  const binPath = account.id + '.bin';
  if (fs.existsSync(binPath)) fs.renameSync(binPath, path.resolve(directoryPath, path.basename(binPath)));
}
