import { CustomerJourneyModule } from './customer-journey.module';
import { JourneyEntryWriter } from './journey-entry-writer.service';
import { JourneyStateService } from './journey-state.service';

describe('CustomerJourneyModule — สัญญา DI ที่โมดูลอื่นพึ่ง (Task 4-6 import โมดูลนี้)', () => {
  it('provide + export JourneyEntryWriter และ JourneyStateService · ไม่ import โมดูลใดเลย (กันวงจรกับ ChatProspects/Customers/LineOa/ChatEngine)', () => {
    expect(Reflect.getMetadata('providers', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('exports', CustomerJourneyModule)).toEqual(expect.arrayContaining([JourneyEntryWriter, JourneyStateService]));
    expect(Reflect.getMetadata('imports', CustomerJourneyModule) ?? []).toEqual([]);
  });
});
