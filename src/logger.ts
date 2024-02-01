import chalk from 'chalk';

export class Logger {
  constructor(private readonly name: string) {}

  public info(...messages: any[]) {
    console.log(new Date().toLocaleTimeString(), '-', chalk.inverse('info'), `[${this.name}]`, ...messages);
  }

  public warn(...messages: any[]) {
    console.log(new Date().toLocaleTimeString(), '-', chalk.bgCyanBright('warn'), `[${this.name}]`, ...messages);
  }

  public error(...messages: any[]) {
    console.log(new Date().toLocaleTimeString(), '-', chalk.bgMagentaBright('error'), `[${this.name}]`, ...messages);
  }
}
