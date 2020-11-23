# @nzws/homebridge-nature-aircon

> エアコン操作プラグイン

Homebridge + Nature Remo でエアコンを操作するプラグインです。
サービスに [Heater Cooler](https://developers.homebridge.io/#/service/HeaterCooler) を使用しているため、風量などの機能が使用できます。

- 私の環境のエアコンでしかテストしていないため、機能が使用できない場合があります。

## Config

```json
{
  "accessory": "NatureAircon",
  "name": "Aircon",
  "accessToken": "/* https://home.nature.global/ */",
  "airconId": "/* uuid */"
}
```
