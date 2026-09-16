import { CustomerJourneyModule } from './customer-journey.module';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';

describe('CustomerJourneyModule — สัญญา DI ที่โมดูลอื่นพึ่ง (Task 4-6 import โมดูลนี้)', () => {
  it('provide + export JourneyEntryWriter และ JourneyStateService · ไม่ import โมดูลใดเลย (กันวงจรกับ ChatProspects/Customers/LineOa/ChatEngine)', () => {
    expect(Reflect.getMetadata('providers', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('imports', CustomerJourneyModule) ?? []).toEqual([]);
  });

  it('บันทึกมือ (POST journey/entries): provide JourneyManualEntryService ในโมดูลเดียวกัน · ไม่ export · ยังไม่ import โมดูลใด', () => {
    expect(Reflect.getMetadata('providers', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyManualEntryService]));
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).not.toContain(JourneyManualEntryService);
    expect(Reflect.getMetadata('imports', CustomerJourneyModule) ?? []).toEqual([]);
  });
});
