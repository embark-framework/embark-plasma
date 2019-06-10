export default class EmbarkUtils {
  constructor({ events, logger, blockchainConfig }) {
    this.events = events;
    this.logger = logger;
    this.blockchainConfig = blockchainConfig;
  }
  get accounts() {
    return new Promise((resolve, reject) => {
      this.events.request("blockchain:ready", () => {
        // this.events.request("blockchain:get", (embarkWeb3) => {
        //   try {
        //     const accountsParsed = AccountParser.parseAccountsConfig(this.blockchainConfig.accounts, embarkWeb3, dappPath(), this.logger, []);
        //     resolve(accountsParsed);
        //   } catch (e) {
        //     reject(e);
        //   }
        // });
        this.events.request("blockchain:getAccounts", (err, accounts) => {
          if (err) {
            return reject(err);
          }
          resolve(accounts);
        });
      });
    });
  }

  // get web3Path() {
  //   return new Promise((resolve, reject) => {
  //     this.events.request("version:get:web3", (web3Version) => {
  //       if (web3Version === "1.0.0-beta") {
  //         const nodePath = embarkPath('node_modules');
  //         const web3Path = require.resolve("web3", { paths: [nodePath] });
  //         return resolve(web3Path);
  //       }
  //       this.events.request("version:getPackageLocation", "web3", web3Version, (err, location) => {
  //         if (err) {
  //           return reject(err);
  //         }
  //         const locationPath = embarkPath(location).replace(/\\/g, '/');
  //         resolve(locationPath);
  //       });
  //     });
  //   });
  // }
}
