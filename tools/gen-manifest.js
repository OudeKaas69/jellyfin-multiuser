#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');

const outfile = process.argv[2];
const appinfo = JSON.parse(fs.readFileSync('frontend/appinfo.json'));
const ipkfile = `${appinfo.id}_${appinfo.version}_all.ipk`;
const ipkhash = crypto.createHash('sha256').update(fs.readFileSync(`build/${ipkfile}`)).digest('hex');

fs.writeFileSync(
  outfile,
  JSON.stringify({
    id: appinfo.id,
    version: appinfo.version,
    type: appinfo.type,
    title: appinfo.title,
    appDescription: appinfo.appDescription,
    iconUri: 'https://raw.githubusercontent.com/OudeKaas69/jellyfin-multiuser/master/frontend/assets/icon-160.png',
    sourceUrl: 'https://github.com/OudeKaas69/jellyfin-multiuser',
    rootRequired: false,
    ipkUrl: ipkfile,
    ipkSize: fs.statSync(`build/${ipkfile}`).size,
    ipkHash: {
      sha256: ipkhash,
    },
  }),
);
