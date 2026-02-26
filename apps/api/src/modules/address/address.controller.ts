import { Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { THAI_ADDRESS_DATA } from './thai-address-data';

@SkipThrottle()
@Controller('address')
export class AddressController {
  @Get('provinces')
  getProvinces() {
    const provinces = [...new Set(THAI_ADDRESS_DATA.map(([p]) => p))];
    return provinces.sort();
  }

  @Get('districts')
  getDistricts(@Query('province') province: string) {
    if (!province) return [];
    const districts = [
      ...new Set(
        THAI_ADDRESS_DATA.filter(([p]) => p === province).map(([, d]) => d),
      ),
    ];
    return districts.sort();
  }

  @Get('subdistricts')
  getSubdistricts(@Query('district') district: string) {
    if (!district) return [];
    const subdistricts = THAI_ADDRESS_DATA.filter(
      ([, d]) => d === district,
    ).map(([, , s, z]) => ({ name: s, zipcode: z }));
    return subdistricts.sort((a, b) => a.name.localeCompare(b.name));
  }
}
