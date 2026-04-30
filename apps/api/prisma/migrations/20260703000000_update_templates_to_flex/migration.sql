-- Convert all 19 notification templates to V3 White Card Flex Messages
-- Each category uses its own theme color but shares the same structural layout:
--   1. Status strip (top, solid color)
--   2. Hero zone (soft tinted bg, brand badge + big number + label)
--   3. Amount card (WHITE bg, COLORED border — V3 signature)
--   4. Consequence/body text (soft tinted bg)
--   5. 3-column info row
--   6. Primary CTA + secondary text link

-- Theme colors:
--   DUNNING       red    strip=#dc2626 hero=#fef2f2 accent=#991b1b/#7f1d1d
--   REMINDER      blue   strip=#2563eb hero=#eff6ff accent=#1e40af/#1e3a8a
--   STAFF         dark   strip=#18181b hero=#f1f5f9 accent=#334155/#0f172a

-- ============================================================================
-- DUNNING category (11 templates) — red theme, urgency tone
-- ============================================================================

-- dunning.reminder (Stage 1 — soft tone, days low)
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type": "bubble",
  "size": "mega",
  "body": {
    "type": "box",
    "layout": "vertical",
    "paddingAll": "none",
    "contents": [
      {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
        {"type":"text","text":"แจ้งเตือนค้างชำระ","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
      ]},
      {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
        {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
        {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
          {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
          {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
        ]},
        {"type":"text","text":"ค้างชำระเกินกำหนด","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
      ]},
      {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
        {"type":"text","text":"ยอดที่ต้องชำระ","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
        {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
          {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
          {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
        ]}
      ]},
      {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
        {"type":"text","text":"กรุณาชำระเงินโดยเร็วเพื่อหลีกเลี่ยงค่าปรับ","color":"#7f1d1d","size":"sm","align":"center","wrap":true}
      ]},
      {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
        {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
        {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
        {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${daysOverdue} วัน","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
      ]}
    ]
  },
  "footer": {
    "type": "box","layout":"vertical","spacing":"sm","contents":[
      {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินเลย","uri":"${paymentUrl}"}},
      {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
    ]
  }
}' WHERE event_type = 'dunning.reminder';

-- dunning.notice (Stage 2 — firm tone)
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type": "bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"ค้างชำระเร่งด่วน","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระเกินกำหนด","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดที่ต้องชำระทันที","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"กรุณาติดต่อชำระเงินทันที","color":"#7f1d1d","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${daysOverdue} วัน","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินทันที","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'dunning.notice';

-- dunning.final_warning (Stage 3 — final warning)
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"เตือนครั้งสุดท้าย","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระเกินกำหนด","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดที่ต้องชำระ","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"หากไม่ชำระภายใน 30 วัน จะดำเนินการตามกฎหมาย","color":"#7f1d1d","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${daysOverdue} วัน","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินทันที","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'dunning.final_warning';

-- dunning.legal_action (Stage 4 — legal notice)
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"แจ้งดำเนินการตามกฎหมาย","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระเกิน 60 วัน","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดที่ต้องชำระ","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"จะดำเนินการยึดคืนสินค้า กรุณาติดต่อร้านทันที","color":"#7f1d1d","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${daysOverdue} วัน","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ติดต่อร้านด่วน","uri":"${contactUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ชำระเงิน","uri":"${paymentUrl}"}}
  ]}
}' WHERE event_type = 'dunning.legal_action';

-- payment.overdue_day_1
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"แจ้งค้างชำระ","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"1","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"เลยกำหนดชำระ","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดงวดที่ ${installmentNo}","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"กรุณาชำระเงินโดยเร็วเพื่อหลีกเลี่ยงค่าปรับ","color":"#7f1d1d","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"งวด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${installmentNo}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินเลย","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'payment.overdue_day_1';

-- payment.overdue_day_3
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"ค้างชำระเร่งด่วน","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"3","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระมาแล้ว","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดงวดที่ ${installmentNo}","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"กรุณาติดต่อร้านเพื่อชำระเงิน","color":"#7f1d1d","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"งวด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${installmentNo}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินทันที","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'payment.overdue_day_3';

-- payment.overdue_day_7
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"ค้างชำระเร่งด่วน","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"7","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระมาแล้ว","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดงวดที่ ${installmentNo}","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"หากไม่ชำระภายใน 7 วัน สถานะสัญญาจะเปลี่ยนเป็น OVERDUE","color":"#7f1d1d","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"งวด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${installmentNo}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินทันที","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'payment.overdue_day_7';

-- contract.status_overdue
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"สัญญาเปลี่ยนสถานะ: OVERDUE","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"วันค้างชำระ","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดรวมค้างชำระ","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${totalOverdue}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"สัญญาถูกปรับสถานะเป็น OVERDUE กรุณาติดต่อร้านทันที","color":"#7f1d1d","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สถานะ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"OVERDUE","color":"#dc2626","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ติดต่อร้านทันที","uri":"${contactUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ชำระเงิน","uri":"${paymentUrl}"}}
  ]}
}' WHERE event_type = 'contract.status_overdue';

-- contract.status_default
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"สัญญาเปลี่ยนสถานะ: DEFAULT","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"วันค้างชำระ — ผิดนัดชำระ","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดรวมค้างชำระ","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${totalOverdue}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ทางร้านจะดำเนินการตามขั้นตอนต่อไป กรุณาติดต่อด่วน","color":"#7f1d1d","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สถานะ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"DEFAULT","color":"#dc2626","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ติดต่อร้านด่วน","uri":"${contactUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ชำระเงิน","uri":"${paymentUrl}"}}
  ]}
}' WHERE event_type = 'contract.status_default';

-- payment.auto_link (payment link send)
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"ลิงก์ชำระเงิน","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${installmentNo}","size":"5xl","weight":"bold","color":"#dc2626","flex":0}
      ]},
      {"type":"text","text":"งวดที่ต้องชำระ","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดที่ต้องชำระ","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#991b1b","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#dc2626","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"กดปุ่มด้านล่างเพื่อชำระเงินผ่าน QR/บัตร","color":"#7f1d1d","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"งวด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${installmentNo}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ยอด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${amount}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเงินผ่าน QR","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'payment.auto_link';

-- mdm.lock_notice (device locked)
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#dc2626","paddingAll":"10px","contents":[
      {"type":"text","text":"เครื่องถูกล็อค","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#991b1b","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#dc2626","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#991b1b","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระ — เครื่องล็อคแล้ว","color":"#7f1d1d","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#dc2626","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"สัญญาที่ถูกล็อค","color":"#991b1b","size":"xs","weight":"bold","align":"center"},
      {"type":"text","text":"${contractNumber}","color":"#dc2626","size":"3xl","weight":"bold","align":"center","margin":"xs"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#fef2f2","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ชำระเงินเพื่อปลดล็อคเครื่อง","color":"#7f1d1d","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สถานะ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"LOCKED","color":"#dc2626","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${daysOverdue} วัน","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#dc2626","action":{"type":"uri","label":"ชำระเพื่อปลดล็อค","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'mdm.lock_notice';

-- ============================================================================
-- REMINDER category (2 templates) — blue theme, friendly tone
-- ============================================================================

-- payment.due_in_3_days
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#2563eb","paddingAll":"10px","contents":[
      {"type":"text","text":"แจ้งเตือนครบกำหนด","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#eff6ff","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#1e40af","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"3","size":"5xl","weight":"bold","color":"#2563eb","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#1e40af","flex":0}
      ]},
      {"type":"text","text":"ก่อนถึงวันครบกำหนด","color":"#1e3a8a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#2563eb","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดงวดที่ ${installmentNo}","color":"#1e40af","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#1e40af","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#2563eb","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#eff6ff","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ครบกำหนด ${dueDate} — ชำระล่วงหน้าได้เลย","color":"#1e3a8a","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"งวด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${installmentNo}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ครบ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${dueDate}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#2563eb","action":{"type":"uri","label":"ชำระล่วงหน้า","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'payment.due_in_3_days';

-- payment.due_in_1_day
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#2563eb","paddingAll":"10px","contents":[
      {"type":"text","text":"เตือนความจำ — พรุ่งนี้ครบกำหนด","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#eff6ff","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE FINANCE","color":"#1e40af","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"1","size":"5xl","weight":"bold","color":"#2563eb","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#1e40af","flex":0}
      ]},
      {"type":"text","text":"ก่อนถึงวันครบกำหนด","color":"#1e3a8a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#2563eb","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดงวดที่ ${installmentNo}","color":"#1e40af","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#1e40af","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${amount}","color":"#2563eb","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#eff6ff","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ครบกำหนดพรุ่งนี้ ${dueDate}","color":"#1e3a8a","size":"sm","align":"center","wrap":true,"weight":"bold"}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"งวด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${installmentNo}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ครบ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${dueDate}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#2563eb","action":{"type":"uri","label":"ชำระเงินเลย","uri":"${paymentUrl}"}},
    {"type":"button","style":"link","height":"sm","action":{"type":"uri","label":"ติดต่อร้าน","uri":"${contactUrl}"}}
  ]}
}' WHERE event_type = 'payment.due_in_1_day';

-- ============================================================================
-- STAFF category (6 templates) — dark slate theme, report tone
-- ============================================================================

-- staff.manager_overdue_summary
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#18181b","paddingAll":"10px","contents":[
      {"type":"text","text":"สรุปสัญญาค้างชำระประจำวัน","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE STAFF","color":"#334155","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${count}","size":"5xl","weight":"bold","color":"#18181b","flex":0},
        {"type":"text","text":" สัญญา","size":"xl","weight":"bold","color":"#334155","flex":0}
      ]},
      {"type":"text","text":"ค้างชำระวันนี้","color":"#0f172a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#18181b","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"ยอดรวม","color":"#334155","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#334155","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${totalAmount}","color":"#18181b","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"${listSummary}","color":"#0f172a","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"วันที่","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${date}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"จำนวน","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${count}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ยอด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${totalAmount}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#18181b","action":{"type":"uri","label":"เปิด Dashboard","uri":"${dashboardUrl}"}}
  ]}
}' WHERE event_type = 'staff.manager_overdue_summary';

-- staff.owner_default_alert
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#18181b","paddingAll":"10px","contents":[
      {"type":"text","text":"แจ้งสัญญา DEFAULT","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE STAFF","color":"#334155","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${daysOverdue}","size":"5xl","weight":"bold","color":"#18181b","flex":0},
        {"type":"text","text":" วัน","size":"xl","weight":"bold","color":"#334155","flex":0}
      ]},
      {"type":"text","text":"ผิดนัดชำระ","color":"#0f172a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#18181b","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"สัญญาที่ผิดนัด","color":"#334155","size":"xs","weight":"bold","align":"center"},
      {"type":"text","text":"${contractNumber}","color":"#18181b","size":"3xl","weight":"bold","align":"center","margin":"xs"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"สัญญาถูกปรับเป็น DEFAULT — กรุณาตรวจสอบและดำเนินการ","color":"#0f172a","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ลูกค้า","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${name}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สัญญา","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${contractNumber}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${daysOverdue} วัน","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#18181b","action":{"type":"uri","label":"ดูสัญญา","uri":"${dashboardUrl}"}}
  ]}
}' WHERE event_type = 'staff.owner_default_alert';

-- staff.daily_report
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#18181b","paddingAll":"10px","contents":[
      {"type":"text","text":"รายงานสรุปวัน","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE STAFF","color":"#334155","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${newContracts}","size":"5xl","weight":"bold","color":"#18181b","flex":0},
        {"type":"text","text":" สัญญา","size":"xl","weight":"bold","color":"#334155","flex":0}
      ]},
      {"type":"text","text":"สัญญาใหม่วันนี้","color":"#0f172a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#18181b","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"รับชำระวันนี้","color":"#334155","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#334155","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${received}","color":"#18181b","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ขายสด ${cashSales} บาท / ผ่อน ${hpSales} บาท","color":"#0f172a","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"วันที่","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${date}","color":"#18181b","size":"xs","weight":"bold","align":"center","wrap":true}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ขายสด","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${cashSales}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ผ่อน","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${hpSales}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#18181b","action":{"type":"uri","label":"เปิด Dashboard","uri":"${dashboardUrl}"}}
  ]}
}' WHERE event_type = 'staff.daily_report';

-- staff.weekly_report
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#18181b","paddingAll":"10px","contents":[
      {"type":"text","text":"รายงานสรุปสัปดาห์","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE STAFF","color":"#334155","weight":"bold","size":"xs","align":"center"},
      {"type":"text","text":"${weekStart} - ${weekEnd}","color":"#0f172a","size":"sm","weight":"bold","align":"center","margin":"md","wrap":true},
      {"type":"text","text":"ยอดขายรวม","color":"#334155","size":"xs","align":"center","margin":"sm"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#334155","size":"md","weight":"bold","flex":0},
        {"type":"text","text":"${totalSales}","color":"#18181b","size":"3xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#18181b","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"รับชำระสัปดาห์","color":"#334155","size":"xs","weight":"bold","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"xs","contents":[
        {"type":"text","text":"฿","color":"#334155","size":"lg","weight":"bold","flex":0},
        {"type":"text","text":"${totalReceived}","color":"#18181b","size":"4xl","weight":"bold","flex":0}
      ]}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ค้างชำระรวม ${totalOverdue} บาท","color":"#0f172a","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ขายรวม","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${totalSales}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"รับชำระ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${totalReceived}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้าง","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${totalOverdue}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#18181b","action":{"type":"uri","label":"เปิด Dashboard","uri":"${dashboardUrl}"}}
  ]}
}' WHERE event_type = 'staff.weekly_report';

-- staff.daily_line_report
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#18181b","paddingAll":"10px","contents":[
      {"type":"text","text":"รายงาน LINE OA","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE STAFF","color":"#334155","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${sent}","size":"5xl","weight":"bold","color":"#18181b","flex":0},
        {"type":"text","text":" ข้อความ","size":"xl","weight":"bold","color":"#334155","flex":0}
      ]},
      {"type":"text","text":"ส่งสำเร็จวันนี้","color":"#0f172a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#18181b","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"สถานะการส่ง","color":"#334155","size":"xs","weight":"bold","align":"center"},
      {"type":"text","text":"ส่งสำเร็จ ${sent} / ล้มเหลว ${failed}","color":"#18181b","size":"xl","weight":"bold","align":"center","margin":"xs","wrap":true}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"ค้างคิว ${pending} ข้อความ","color":"#0f172a","size":"sm","align":"center","wrap":true}
    ]},
    {"type":"box","layout":"horizontal","margin":"lg","paddingAll":"8px","contents":[
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"สำเร็จ","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${sent}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ล้มเหลว","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${failed}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]},
      {"type":"box","layout":"vertical","contents":[{"type":"text","text":"ค้างคิว","color":"#64748b","size":"xxs","align":"center"},{"type":"text","text":"${pending}","color":"#18181b","size":"xs","weight":"bold","align":"center"}]}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#18181b","action":{"type":"uri","label":"เปิด Dashboard","uri":"${dashboardUrl}"}}
  ]}
}' WHERE event_type = 'staff.daily_line_report';

-- staff.sms_credit_low
UPDATE notification_templates SET format = 'flex', flex_template = '{
  "type":"bubble","size":"mega",
  "body":{"type":"box","layout":"vertical","paddingAll":"none","contents":[
    {"type":"box","layout":"vertical","backgroundColor":"#18181b","paddingAll":"10px","contents":[
      {"type":"text","text":"เครดิต SMS ใกล้หมด","color":"#ffffff","weight":"bold","size":"sm","align":"center"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"16px","contents":[
      {"type":"text","text":"BESTCHOICE STAFF","color":"#334155","weight":"bold","size":"xs","align":"center"},
      {"type":"box","layout":"baseline","justifyContent":"center","margin":"md","contents":[
        {"type":"text","text":"${credit}","size":"5xl","weight":"bold","color":"#18181b","flex":0},
        {"type":"text","text":" เครดิต","size":"xl","weight":"bold","color":"#334155","flex":0}
      ]},
      {"type":"text","text":"คงเหลือ","color":"#0f172a","size":"sm","weight":"bold","align":"center","margin":"sm"}
    ]},
    {"type":"box","layout":"vertical","margin":"lg","paddingAll":"14px","marginStart":"lg","marginEnd":"lg","backgroundColor":"#ffffff","borderColor":"#18181b","borderWidth":"2px","cornerRadius":"10px","contents":[
      {"type":"text","text":"สถานะ","color":"#334155","size":"xs","weight":"bold","align":"center"},
      {"type":"text","text":"กรุณาเติมเครดิต","color":"#18181b","size":"xl","weight":"bold","align":"center","margin":"xs"}
    ]},
    {"type":"box","layout":"vertical","backgroundColor":"#f1f5f9","paddingAll":"12px","margin":"lg","contents":[
      {"type":"text","text":"เติมก่อนหมดเพื่อไม่ให้ส่ง SMS แจ้งเตือนล้มเหลว","color":"#0f172a","size":"sm","align":"center","wrap":true}
    ]}
  ]},
  "footer":{"type":"box","layout":"vertical","spacing":"sm","contents":[
    {"type":"button","style":"primary","color":"#18181b","action":{"type":"uri","label":"เติมเครดิต","uri":"${dashboardUrl}"}}
  ]}
}' WHERE event_type = 'staff.sms_credit_low';

-- ============================================================================
-- Update sample_data with URL placeholders so preview works
-- ============================================================================

-- DUNNING templates need paymentUrl + contactUrl
UPDATE notification_templates
SET sample_data = sample_data || '{"paymentUrl":"https://liff.line.me/sample/pay","contactUrl":"https://line.me/R/ti/p/@bestchoice"}'::jsonb
WHERE category = 'DUNNING';

-- REMINDER templates need paymentUrl + contactUrl
UPDATE notification_templates
SET sample_data = sample_data || '{"paymentUrl":"https://liff.line.me/sample/pay","contactUrl":"https://line.me/R/ti/p/@bestchoice"}'::jsonb
WHERE category = 'REMINDER';

-- STAFF templates need dashboardUrl
UPDATE notification_templates
SET sample_data = sample_data || '{"dashboardUrl":"https://app.bestchoice.com/dashboard"}'::jsonb
WHERE category = 'STAFF';
