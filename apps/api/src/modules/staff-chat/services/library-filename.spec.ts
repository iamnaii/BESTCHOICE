import { libraryFilename } from './library-filename';
describe('library multipart filenames',()=>{
 it('decodes UTF-8 bytes exposed by multipart latin1 parsing before sanitizing',()=>{
  const raw=Buffer.from('โปรโมชั่นมือถือ📱.jpg','utf8').toString('latin1');
  expect(libraryFilename(raw,'jpg')).toBe('โปรโมชั่นมือถือ📱.jpg');
 });
 it('preserves direct Unicode, genuine Latin characters and ASCII',()=>{
  for(const name of ['สินค้า.jpg','café.jpg','manual.pdf'])expect(libraryFilename(name,'jpg')).toBe(name);
 });
 it('removes control bytes and path separators and supplies an empty-name fallback',()=>{
  expect(libraryFilename('../a\\b\u0000.jpg','jpg')).toBe('.._a_b_.jpg');
  expect(libraryFilename('  ','pdf')).toBe('ไฟล์.pdf');
 });
});
