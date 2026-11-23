import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from '../../products/dto/create-product.dto';
import { UploadProductPhotoDto } from './product-photo.dto';
const photo = 'data:image/png;base64,YQ==';
describe('named product photo DTOs', () => {
  it('validates nested photos and rejects unknown slot names', async () => {
    const input = { name: 'test', brand: 'test', model: 'test', category: 'PHONE_NEW', branchId: 'b', costPrice: 1,
      anglePhotos: { front: photo }, evidencePhotos: { imeiScreen: photo } };
    expect(await validate(plainToInstance(CreateProductDto, input), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(await validate(plainToInstance(CreateProductDto, { ...input, evidencePhotos: { front: photo } }), { whitelist: true, forbidNonWhitelisted: true })).not.toEqual([]);
    expect(await validate(plainToInstance(CreateProductDto, { ...input, anglePhotos: { front: 'https://external/image.png' } }))).not.toEqual([]);
  });
  it('accepts named evidence slots, never arbitrary product columns', async () => {
    expect(await validate(plainToInstance(UploadProductPhotoDto, { angle: 'batteryScreen', photo }))).toEqual([]);
    expect(await validate(plainToInstance(UploadProductPhotoDto, { angle: 'uploadedById', photo }))).not.toEqual([]);
  });
});
