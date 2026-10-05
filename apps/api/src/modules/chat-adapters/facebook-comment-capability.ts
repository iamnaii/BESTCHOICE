export interface FacebookCommentEvidence {
  graphVersion: string;
  verified: boolean;
  receive?: boolean;
  publicReply?: boolean;
  privateReply?: boolean;
}
export function capabilityFromEvidence(input: FacebookCommentEvidence) {
  return {
    graphVersion: input.graphVersion,
    receive: input.verified && input.receive === true,
    publicReply: input.verified && input.publicReply === true,
    privateReply: input.verified && input.privateReply === true,
    reason: input.verified ? null : 'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ',
  };
}
