import * as NatureRemo from 'nature-remo';
import { API, HAP, Logging, AccessoryConfig, Service } from 'homebridge';

let hap: HAP;

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory('NatureAircon', NatureAircon);
};

class NatureAircon {
  private readonly log: Logging;
  private readonly config: AccessoryConfig;
  private readonly api: API;
  private readonly Service;
  private readonly Characteristic;

  private readonly informationService: Service;
  private readonly service: Service;

  private readonly natureClient?: NatureRemo.Cloud;
  private device?: NatureRemo.IAppliance;
  private sensor?: NatureRemo.ISensorValue;

  private warmTemp?: number;
  private coolTemp?: number;
  private isSwing = false;

  /**
   * REQUIRED - This is the entry point to your plugin
   */
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.service = new hap.Service.HeaterCooler(config.name);

    if (config.accessToken) {
      this.natureClient = new NatureRemo.Cloud(config.accessToken);
      this._getAirconStatus();
      setInterval(this._getAirconStatus.bind(this), 1000 * 60 * 5);
    } else {
      this.log.info('accessToken is not found, running in test mode.');
    }

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));

    this.service
      .getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
      .on('get', this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .on('get', this.handleTargetHeaterCoolerStateGet.bind(this))
      .on('set', this.handleTargetHeaterCoolerStateSet.bind(this));

    this.service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
      .on('get', this.handleCoolingThresholdTemperatureGet.bind(this))
      .on('set', this.handleCoolingThresholdTemperatureSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .on('get', this.handleHeatingThresholdTemperatureGet.bind(this))
      .on('set', this.handleHeatingThresholdTemperatureSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.RotationSpeed)
      .on('get', this.handleRotationSpeedGet.bind(this))
      .on('set', this.handleRotationSpeedSet.bind(this));

    this.service.getCharacteristic(this.Characteristic.SwingMode)
      .on('get', this.handleSwingModeGet.bind(this))
      .on('set', this.handleSwingModeSet.bind(this));


    this.informationService = new this.Service.AccessoryInformation()
      .setCharacteristic(this.Characteristic.Manufacturer, 'homebridge.io')
      .setCharacteristic(this.Characteristic.Model, 'homebridge')
      .setCharacteristic(this.Characteristic.SerialNumber, 'ho-me-br-id-ge');
  }

  /**
   * REQUIRED - This must return an array of the services you want to expose.
   * This method must be named "getServices".
   */
  getServices() {
    return [this.informationService, this.service];
  }

  handleOnGet(callback) {
    this.log.info('handleOnGet');
    const number = this._getActive();

    callback(null, number);
  }

  async handleOnSet(value, callback) {
    const number = this._getActive();
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    if (value === number) {
      return callback(null);
    }
    this.log.info('handleOnSet:', value);
    const { INACTIVE, ACTIVE } = this.Characteristic.Active;

    if (value === ACTIVE) {
      const {
        settings: { mode },
      } = this.device;
      await this._updateAircon({
        operation_mode: mode,
      });
    } else if (value === INACTIVE) {
      await this._updateAircon({ button: 'power-off' });
    }

    callback(null);
  }

  private _getActive(): number {
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    const { INACTIVE, ACTIVE } = this.Characteristic.Active;
    const { button } = this.device.settings;

    return button === 'power-off' ? INACTIVE : ACTIVE;
  }

  handleCurrentHeaterCoolerStateGet(callback) {
    this.log.info('handleCurrentHeaterCoolerStateGet');
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    const {
      INACTIVE,
      HEATING,
      COOLING,
    } = this.Characteristic.CurrentHeaterCoolerState;
    const { mode } = this.device.settings;

    if (this._getActive() === 0) {
      return callback(null, INACTIVE);
    }

    switch (mode) {
      case 'cool':
        return callback(null, COOLING);
      case 'warm':
        return callback(null, HEATING);
      default:
        return callback(null, INACTIVE);
    }
  }

  handleTargetHeaterCoolerStateGet(callback) {
    this.log.info('handleTargetHeaterCoolerStateGet');
    const number = this._getTargetHCState();

    callback(null, number);
  }

  async handleTargetHeaterCoolerStateSet(value, callback) {
    this.log.info('handleTargetHeaterCoolerStateSet', value);
    const number = this._getTargetHCState();
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    if (value === number) {
      return callback(null);
    }
    const { AUTO, HEAT, COOL } = this.Characteristic.TargetHeaterCoolerState;
    const mode: {
      [key: number]: NatureRemo.IAirconModeType;
    } = {
      [AUTO]: 'auto',
      [HEAT]: 'warm',
      [COOL]: 'cool',
    };
    const temp = mode[value] === 'warm' ? this.warmTemp : this.coolTemp;

    await this._updateAircon({
      operation_mode: mode[value],
      ...(temp ? { temperature: temp.toString() } : {}),
    });

    callback(null);
  }

  private _getTargetHCState(): number {
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    const { AUTO, HEAT, COOL } = this.Characteristic.TargetHeaterCoolerState;
    const { mode } = this.device.settings;

    switch (mode) {
      case 'cool':
        return COOL;
      case 'warm':
        return HEAT;
      default:
        return AUTO;
    }
  }

  handleCurrentTemperatureGet(callback) {
    this.log.info('handleCurrentTemperatureGet');

    callback(null, this.sensor?.temperature || 0);
  }

  handleCoolingThresholdTemperatureGet(callback) {
    this.log.info('handleCoolingThresholdTemperatureGet');
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    if (!this.coolTemp) {
      this.coolTemp = parseInt(this.device.settings.temp);
    }

    callback(null, this.coolTemp);
  }

  async handleCoolingThresholdTemperatureSet(value, callback) {
    this.log.info('handleCoolingThresholdTemperatureSet', value);
    if (!this.device) {
      throw new Error('device is not initialized');
    }

    const prev = this.coolTemp;
    this.coolTemp = value;
    if (this.device.settings.mode === 'cool') {
      try {
        await this._updateAircon({
          temperature: value,
        });
      } catch (e) {
        this.coolTemp = prev;
        throw e;
      }
    }

    callback(null);
  }

  handleHeatingThresholdTemperatureGet(callback) {
    this.log.info('handleHeatingThresholdTemperatureGet');
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    if (!this.warmTemp) {
      this.warmTemp = parseInt(this.device.settings.temp);
    }

    callback(null, this.warmTemp);
  }

  async handleHeatingThresholdTemperatureSet(value, callback) {
    this.log.info('handleHeatingThresholdTemperatureSet', value);
    if (!this.device) {
      throw new Error('device is not initialized');
    }

    const prev = this.warmTemp;
    this.warmTemp = value;
    if (this.device.settings.mode === 'warm') {
      try {
        await this._updateAircon({
          temperature: value,
        });
      } catch (e) {
        this.warmTemp = prev;
        throw e;
      }
    }

    callback(null);
  }

  handleRotationSpeedGet(callback) {
    this.log.info('handleRotationSpeedGet');
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    const { vol, mode } = this.device.settings;
    const { count } = this._getVols(mode);
    const isAuto = vol === 'auto';
    const percentage = Math.ceil(
      (100 / count) * parseInt(vol),
    );

    callback(undefined, isAuto ? 0 : percentage);
  }

  async handleRotationSpeedSet(value, callback) {
    this.log.info('handleRotationSpeedSet', value);
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    const { mode, vol } = this.device.settings;
    const { count, hasAuto } = this._getVols(mode);
    const newCount = Math.min(
      count,
      Math.max(Math.ceil(value / (100 / count)), 1),
    );
    const air_volume = hasAuto && value === 0 ? '0' : newCount.toString();
    this.log.info('handleRotationSpeedSet', {
      value,
      newCount,
      vol,
      air_volume,
    });
    if (vol === air_volume) {
      return callback(null);
    }

    await this._updateAircon({
      air_volume,
    });
    callback(null);
  }

  handleSwingModeGet(callback) {
    const { SWING_DISABLED, SWING_ENABLED } = this.Characteristic.SwingMode;
    callback(null, this.isSwing ? SWING_ENABLED : SWING_DISABLED);
  }

  async handleSwingModeSet(value, callback) {
    this.log.info('handleSwingModeSet', value);
    if (!this.device) {
      throw new Error('device is not initialized');
    }
    if (this._getActive() === 0) {
      return callback(null);
    }

    this.isSwing = !this.isSwing;
    try {
      await this._updateAircon({
        button: 'airdir-swing',
      });
    } catch (e) {
      this.isSwing = !this.isSwing;
      throw e;
    }
    callback(null);
  }

  private _getTempThreshold(mode: NatureRemo.IAirconModeType): Array<number> {
    if (!this.device || !this.device.aircon) {
      return [];
    }
    const { temp } = this.device.aircon.range.modes[mode];

    return [parseInt(temp[0]), parseInt(temp[temp.length - 1])];
  }

  private _getVols(mode: NatureRemo.IAirconModeType): {
    count: number;
    hasAuto: boolean;
  } {
    if (!this.device || !this.device.aircon) {
      throw new Error('device is not initialized');
    }
    const { vol } = this.device.aircon.range.modes[mode];
    const hasAuto = vol[vol.length - 1] === 'auto';

    return {
      count: hasAuto ? vol.length - 1 : vol.length,
      hasAuto,
    };
  }

  private async _updateAircon(
    newConfig: Partial<NatureRemo.IUpdateAirconSettingsOptions>,
  ) {
    if (!this.natureClient || !this.device) {
      throw new Error('device is not initialized');
    }

    const response = await this.natureClient.updateAirconSettings(
      this.device.id,
      newConfig,
    );
    this.device.settings = response;
  }

  private _getAirconStatus() {
    const id = this.config.airconId;
    if (!this.natureClient) {
      return;
    }

    this.natureClient.getSensorValue().then((sensor) => {
      this.sensor = sensor;
      this.service.updateCharacteristic(
        this.Characteristic.CurrentTemperature,
        sensor.temperature,
      );
    });

    this.natureClient
      .listAircon()
      .then((devices) =>
        devices.find((i, key) => i.id === id || (!id && key === 0)),
      )
      .then((device) => {
        if (!device) {
          throw new Error('not found device');
        }
        this.log.debug('newStatus', device);

        this.device = device;

        const cool = this._getTempThreshold('cool');
        this.service
          .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
          .setProps({
            minValue: cool[0],
            maxValue: cool[1],
            minStep: 1,
          });
        const warm = this._getTempThreshold('warm');
        this.service
          .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
          .setProps({
            minValue: warm[0],
            maxValue: warm[1],
            minStep: 1,
          });

        // @ts-expect-error: temp_unit が型に無いっぽい
        const isC = device.settings.temp_unit === 'c';
        const {
          CELSIUS,
          FAHRENHEIT,
        } = this.Characteristic.TemperatureDisplayUnits;
        this.service.updateCharacteristic(
          this.Characteristic.TemperatureDisplayUnits,
          isC ? CELSIUS : FAHRENHEIT,
        );
      });
  }
}
