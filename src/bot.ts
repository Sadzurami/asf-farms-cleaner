import Cheerio from 'cheerio';
import got, { Got } from 'got';
import { HttpsProxyAgent } from 'hpagent';
import { Agent } from 'https';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import { StartLoginSessionWithCredentialsDetails as LoginCredentials } from 'steam-session/dist/interfaces-external';
import SteamTotp from 'steam-totp';
import { CookieJar } from 'tough-cookie';

import { Account } from './interfaces/account.interface';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class Bot {
  public readonly account: Account;
  public readonly proxy: string;

  public bans?: string[];
  public level?: number;

  private readonly session: LoginSession;
  private readonly client: Got;
  private readonly agent: Agent | HttpsProxyAgent;

  constructor(account: Account, proxy: string | null = null) {
    this.account = account;
    this.proxy = proxy;

    this.agent = proxy
      ? new HttpsProxyAgent({ proxy, keepAlive: true, timeout: 65000 })
      : new Agent({ keepAlive: true, timeout: 65000 });

    this.client = got.extend({
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'user-agent': USER_AGENT,
      },
      agent: { https: this.agent },
      timeout: 35000,
      cookieJar: new CookieJar(),
      throwHttpErrors: false,
    });

    this.session = new LoginSession(EAuthTokenPlatformType.MobileApp, { agent: this.agent });
  }

  public async start() {
    try {
      await this.retrieveToken();
      await this.retrieveCookies();

      await this.retriveBansInfo();
      await this.retrieveProfileLevel();
    } catch (error) {
      this.stop();
      throw new Error('Failed to start', { cause: error });
    }
  }

  public stop() {
    this.agent.destroy();
  }

  private async retrieveToken() {
    const session = this.session;
    session.on('error', () => {});

    const credentials: LoginCredentials = { accountName: this.account.username, password: this.account.password };
    if (this.account.secret) credentials.steamGuardCode = SteamTotp.getAuthCode(this.account.secret);

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          session.cancelLoginAttempt();

          reject(new Error('Session timed out'));
        }, 30 * 1000);

        session.once('authenticated', () => {
          session.cancelLoginAttempt();
          clearTimeout(timeout);

          resolve();
        });

        session.once('error', (error) => {
          session.cancelLoginAttempt();
          clearTimeout(timeout);

          reject(new Error('Session error', { cause: error }));
        });

        session.once('timeout', () => {
          session.cancelLoginAttempt();
          clearTimeout(timeout);

          reject(new Error('Session timed out'));
        });

        session
          .startWithCredentials(credentials)
          .then((result) => {
            if (!result.actionRequired) return;

            session.cancelLoginAttempt();
            clearTimeout(timeout);

            reject(new Error('Session requires guard action'));
          })
          .catch((error) => reject(error));
      });
    } catch (error) {
      throw new Error('Failed to retrieve token', { cause: error });
    }
  }

  private async retrieveCookies() {
    const session = this.session;

    try {
      let cookies: string[] = await session.getWebCookies();

      cookies = cookies.filter((cookie) => !cookie.startsWith('Steam_Language='));
      cookies.push('Steam_Language=english');

      const jar = this.client.defaults.options.cookieJar as CookieJar;
      for (const cookie of cookies) {
        jar.setCookieSync(cookie, 'https://steamcommunity.com');
        jar.setCookieSync(cookie, 'https://store.steampowered.com');
      }
    } catch (error) {
      throw new Error('Failed to retrieve cookies', { cause: error });
    }
  }

  private async retriveBansInfo() {
    const bans = [];

    try {
      const response = await this.client.get('https://store.steampowered.com/account/supportmessages').text();
      if (response.includes('Account functionality has been restricted')) bans.push('community ban');
    } catch (error) {
      throw new Error('Failed to retrieve bans info', { cause: error });
    }

    this.bans = bans;
  }

  private async retrieveProfileLevel() {
    try {
      const response = await this.client.get('https://steamcommunity.com/my/badges').text();
      const $ = Cheerio.load(response);

      const level = $('.profile_xp_block .friendPlayerLevelNum').text();
      if (!level) throw new Error('Bad server response');

      this.level = parseInt(level, 10);
    } catch (error) {
      throw new Error('Failed to retrieve profile level', { cause: error });
    }
  }
}
