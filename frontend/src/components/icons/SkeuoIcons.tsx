// 拟物化 SVG 图标库
// 风格：厚重金属 + 玻璃反光 + 微高光
// 尺寸：24x24 viewBox，可缩放

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const baseProps = (size = 24) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
});

// 通用渐变定义：金色高光
const GoldGradient = ({ id }: { id: string }) => (
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#FFE48A" />
      <stop offset="50%" stopColor="#C49A3F" />
      <stop offset="100%" stopColor="#5A4012" />
    </linearGradient>
  </defs>
);

/* ===== 场景图标（20个） ===== */

// 1. 餐厅点餐 - 刀叉
export const IconRestaurant = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-rest" />
    {/* 餐刀 */}
    <path d="M8 3 L8 21 M8 3 C6 3 5 5 5 8 L5 12 L8 12 Z"
      fill="url(#g-rest)" stroke="#5A4012" strokeWidth="0.5" />
    {/* 餐叉 */}
    <path d="M16 3 L16 21 M16 3 L13 3 L13 9 L14.5 9 L14.5 3 M19 3 L19 9 L17.5 9 L17.5 3 L16 3"
      fill="url(#g-rest)" stroke="#5A4012" strokeWidth="0.5" />
    {/* 高光 */}
    <path d="M7 4 L7 11" stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
    <path d="M17 4 L17 8" stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
  </svg>
);

// 2. 问路 - 罗盘
export const IconCompass = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-compass" />
    <circle cx="12" cy="12" r="9" fill="url(#g-compass)" stroke="#5A4012" strokeWidth="1" />
    <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
    {/* 指针 */}
    <path d="M12 5 L14 12 L12 19 L10 12 Z" fill="#8B2E2E" stroke="#3A0A0A" strokeWidth="0.5" />
    <path d="M12 5 L14 12 L12 12 Z" fill="#E8625A" />
    <circle cx="12" cy="12" r="1.5" fill="#3A2418" />
  </svg>
);

// 3. 购物 - 购物袋
export const IconShopping = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-shop" />
    {/* 袋身 */}
    <path d="M5 9 L6 20 Q6 21 7 21 L17 21 Q18 21 18 20 L19 9 Z"
      fill="url(#g-shop)" stroke="#5A4012" strokeWidth="0.5" />
    {/* 提手 */}
    <path d="M9 9 L9 7 Q9 4 12 4 Q15 4 15 7 L15 9"
      fill="none" stroke="#5A4012" strokeWidth="1.5" strokeLinecap="round" />
    {/* 高光 */}
    <path d="M7 11 L7.5 18" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
  </svg>
);

// 4. 自我介绍 - 名片
export const IconBusinessCard = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-card" />
    <rect x="3" y="6" width="18" height="13" rx="1.5" fill="url(#g-card)" stroke="#5A4012" strokeWidth="0.5" />
    {/* 头像圆 */}
    <circle cx="8" cy="11" r="2" fill="#5A4012" />
    {/* 文字线条 */}
    <rect x="11.5" y="10" width="7" height="0.8" fill="#5A4012" />
    <rect x="11.5" y="12" width="5" height="0.8" fill="#5A4012" opacity="0.6" />
    <rect x="6" y="15" width="12" height="0.8" fill="#5A4012" opacity="0.6" />
    <rect x="6" y="17" width="9" height="0.8" fill="#5A4012" opacity="0.6" />
  </svg>
);

// 5. 打电话 - 听筒
export const IconPhone = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-phone" />
    <path d="M5 4 Q5 3 6 3 L9 3 Q10 3 10 4 L10 7 Q10 8 9 8.5 L8 9.5
             Q9 12 12 14.5 Q14.5 16 15 16 L16 15 Q17 14 18 14 L21 14
             Q22 14 22 15 L22 18 Q22 19 21 20 Q17 21 12 19
             Q7 17 5 12 Q4 8 5 4 Z"
      fill="url(#g-phone)" stroke="#5A4012" strokeWidth="0.5" />
    <path d="M7 5 L8 6" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
  </svg>
);

// 6. 工作面试 - 文件夹
export const IconInterview = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-int" />
    <path d="M3 6 Q3 5 4 5 L9 5 L11 7 L20 7 Q21 7 21 8 L21 19 Q21 20 20 20 L4 20 Q3 20 3 19 Z"
      fill="url(#g-int)" stroke="#5A4012" strokeWidth="0.5" />
    <path d="M7 11 L17 11 M7 14 L17 14 M7 17 L13 17" stroke="#5A4012" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

// 7. 商务谈判 - 公文包
export const IconBusiness = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-biz" />
    <rect x="8" y="4" width="8" height="3" rx="0.5" fill="url(#g-biz)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="3" y="7" width="18" height="13" rx="1.5" fill="url(#g-biz)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="10" y="11" width="4" height="2.5" rx="0.3" fill="#5A4012" />
    <line x1="11.5" y1="11" x2="11.5" y2="13.5" stroke="#C49A3F" strokeWidth="0.5" />
  </svg>
);

// 8. 看医生 - 听诊器
export const IconDoctor = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-doc" />
    {/* 听头 */}
    <circle cx="6" cy="18" r="3" fill="url(#g-doc)" stroke="#5A4012" strokeWidth="0.5" />
    <circle cx="6" cy="18" r="1" fill="#5A4012" />
    {/* 管线 */}
    <path d="M6 15 Q6 8 12 8 L12 5" fill="none" stroke="#5A4012" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 5 L14 3 M12 5 L14 7" stroke="#5A4012" strokeWidth="1.5" strokeLinecap="round" />
    {/* 副管 */}
    <path d="M18 18 Q18 10 12 10" fill="none" stroke="#5A4012" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// 9. 银行开户 - 钱币
export const IconBank = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-bank" />
    {/* 三角顶 */}
    <path d="M12 3 L21 9 L3 9 Z" fill="url(#g-bank)" stroke="#5A4012" strokeWidth="0.5" />
    {/* 柱 */}
    <rect x="5" y="10" width="2" height="8" fill="url(#g-bank)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="11" y="10" width="2" height="8" fill="url(#g-bank)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="17" y="10" width="2" height="8" fill="url(#g-bank)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="3" y="19" width="18" height="2" fill="url(#g-bank)" stroke="#5A4012" strokeWidth="0.5" />
  </svg>
);

// 10. 租房 - 房子
export const IconRental = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-rent" />
    <path d="M3 11 L12 4 L21 11 L21 20 L3 20 Z" fill="url(#g-rent)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="10" y="14" width="4" height="6" fill="#3A2418" />
    <rect x="5" y="12" width="3" height="3" fill="#5A4012" />
    <rect x="16" y="12" width="3" height="3" fill="#5A4012" />
  </svg>
);

// 11. 机场通关 - 飞机
export const IconAirport = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-air" />
    <path d="M21 12 L14 14 L8 10 L6 10 L7 12 L4 13 L4 14 L8 14 L11 16 L11 17 L9 18 L9 19 L13 18 L15 19 L16 19 L15 17 L17 16 L20 17 L21 16 Z"
      fill="url(#g-air)" stroke="#5A4012" strokeWidth="0.5" />
  </svg>
);

// 12. 租车出行 - 汽车
export const IconCar = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-car" />
    <path d="M3 15 L5 9 Q5 8 6 8 L18 8 Q19 8 19 9 L21 15 L21 18 L19 18 L19 16 L5 16 L5 18 L3 18 Z"
      fill="url(#g-car)" stroke="#5A4012" strokeWidth="0.5" />
    <circle cx="7" cy="16" r="2" fill="#3A2418" />
    <circle cx="17" cy="16" r="2" fill="#3A2418" />
    <circle cx="7" cy="16" r="0.8" fill="#C0C2C8" />
    <circle cx="17" cy="16" r="0.8" fill="#C0C2C8" />
  </svg>
);

// 13. 社交聚会 - 酒杯
export const IconSocial = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-soc" />
    <path d="M6 4 L18 4 L17 12 Q17 14 15 14 L9 14 Q7 14 7 12 Z"
      fill="url(#g-soc)" stroke="#5A4012" strokeWidth="0.5" />
    <line x1="12" y1="14" x2="12" y2="20" stroke="#5A4012" strokeWidth="1.5" />
    <ellipse cx="12" cy="20.5" rx="4" ry="0.8" fill="url(#g-soc)" stroke="#5A4012" strokeWidth="0.5" />
  </svg>
);

// 14. 客服电话 - 耳机
export const IconCustomer = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-cus" />
    <path d="M4 13 Q4 5 12 5 Q20 5 20 13" fill="none" stroke="#5A4012" strokeWidth="2" strokeLinecap="round" />
    <rect x="3" y="13" width="4" height="6" rx="1" fill="url(#g-cus)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="17" y="13" width="4" height="6" rx="1" fill="url(#g-cus)" stroke="#5A4012" strokeWidth="0.5" />
  </svg>
);

// 15. 快递取件 - 包裹
export const IconDelivery = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-del" />
    <rect x="3" y="8" width="18" height="13" fill="url(#g-del)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="3" y="6" width="18" height="3" fill="#8B6A20" stroke="#5A4012" strokeWidth="0.5" />
    <line x1="12" y1="8" x2="12" y2="21" stroke="#5A4012" strokeWidth="0.8" />
    {/* 封箱胶带 */}
    <rect x="10" y="8" width="4" height="13" fill="#3A2418" opacity="0.3" />
  </svg>
);

// 16. 健身房 - 哑铃
export const IconGym = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-gym" />
    <rect x="2" y="9" width="3" height="6" rx="0.5" fill="url(#g-gym)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="19" y="9" width="3" height="6" rx="0.5" fill="url(#g-gym)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="5" y="11" width="2" height="3" fill="url(#g-gym)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="17" y="11" width="2" height="3" fill="url(#g-gym)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="7" y="11" width="10" height="3" fill="url(#g-gym)" stroke="#5A4012" strokeWidth="0.5" />
  </svg>
);

// 17. 酒店入住 - 床
export const IconHotel = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-hot" />
    <rect x="2" y="14" width="20" height="4" fill="url(#g-hot)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="4" y="10" width="6" height="4" rx="1" fill="#F5EFE0" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="14" y="10" width="6" height="4" rx="1" fill="#F5EFE0" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="2" y="18" width="20" height="2" fill="#5A4012" />
    <line x1="4" y1="6" x2="4" y2="14" stroke="#5A4012" strokeWidth="1.5" />
    <line x1="20" y1="6" x2="20" y2="14" stroke="#5A4012" strokeWidth="1.5" />
  </svg>
);

// 18. 校园生活 - 毕业帽
export const IconCampus = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-cam" />
    <path d="M12 4 L22 9 L12 14 L2 9 Z" fill="url(#g-cam)" stroke="#5A4012" strokeWidth="0.5" />
    <path d="M6 11 L6 16 Q12 19 18 16 L18 11" fill="url(#g-cam)" stroke="#5A4012" strokeWidth="0.5" />
    <line x1="20" y1="10" x2="20" y2="17" stroke="#5A4012" strokeWidth="0.8" />
    <circle cx="20" cy="18" r="1" fill="#C49A3F" />
  </svg>
);

// 19. 节日祝福 - 礼物盒
export const IconFestival = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <GoldGradient id="g-fes" />
    <rect x="3" y="10" width="18" height="11" fill="url(#g-fes)" stroke="#5A4012" strokeWidth="0.5" />
    <rect x="3" y="10" width="18" height="2" fill="#8B2E2E" />
    <rect x="11" y="10" width="2" height="11" fill="#8B2E2E" />
    {/* 蝴蝶结 */}
    <path d="M12 10 L8 6 L9 5 L12 8 L15 5 L16 6 Z" fill="#8B2E2E" stroke="#3A0A0A" strokeWidth="0.5" />
  </svg>
);

// 20. 紧急情况 - 警示牌
export const IconEmergency = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <path d="M12 3 L22 20 L2 20 Z" fill="#FFD75A" stroke="#5A4012" strokeWidth="1" />
    <rect x="11" y="8" width="2" height="6" fill="#3A2418" />
    <circle cx="12" cy="16.5" r="1" fill="#3A2418" />
  </svg>
);

// 锁图标
export const IconLock = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <rect x="5" y="11" width="14" height="10" rx="1.5" fill="url(#g-cus)" stroke="#5A4012" strokeWidth="0.5" />
    <GoldGradient id="g-lock" />
    <path d="M8 11 L8 7 Q8 4 12 4 Q16 4 16 7 L16 11" fill="none" stroke="#5A4012" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="15.5" r="1.5" fill="#5A4012" />
  </svg>
);

/* ===== 操作图标 ===== */

// 播放（实心三角，带金属圈）
export const IconPlay = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2" />
    <path d="M9 7 L9 17 L18 12 Z" fill="currentColor" />
  </svg>
);

// 录音（红点）
export const IconMic = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
    <path d="M5 11 Q5 17 12 17 Q19 17 19 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// 停止（方块）
export const IconStop = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
  </svg>
);

// 喇叭
export const IconSpeaker = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <path d="M3 9 L3 15 L7 15 L13 20 L13 4 L7 9 Z" fill="currentColor" />
    <path d="M16 8 Q19 12 16 16 M18 6 Q22 12 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// 火花/AI
export const IconSparkle = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <path d="M12 3 L13.5 9 L19 10.5 L13.5 12 L12 18 L10.5 12 L5 10.5 L10.5 9 Z" fill="currentColor" />
    <circle cx="19" cy="5" r="1.5" fill="currentColor" />
    <circle cx="5" cy="19" r="1" fill="currentColor" />
  </svg>
);

// 报告/统计
export const IconReport = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <rect x="4" y="13" width="3" height="8" rx="0.5" fill="currentColor" />
    <rect x="10.5" y="9" width="3" height="12" rx="0.5" fill="currentColor" />
    <rect x="17" y="5" width="3" height="16" rx="0.5" fill="currentColor" />
  </svg>
);

// 加号
export const IconPlus = ({ size = 24, ...props }: IconProps) => (
  <svg {...baseProps(size)} {...props}>
    <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

// 场景图标映射表 - 通过 id 前缀或特殊 id 匹配
const ICON_BY_ID: Record<string, React.FC<IconProps>> = {
  // free
  free_01: IconRestaurant,   // 餐厅点餐
  free_02: IconCompass,      // 问路
  free_03: IconShopping,     // 购物
  free_04: IconBusinessCard, // 自我介绍
  free_05: IconPhone,        // 打电话
  // pro
  pro_01: IconInterview,     // 工作面试
  pro_02: IconBusiness,      // 商务谈判
  pro_03: IconDoctor,        // 看病就医
  pro_04: IconBank,          // 银行开户
  pro_05: IconRental,        // 租房看房
  pro_06: IconAirport,       // 机场通关
  pro_07: IconCar,           // 租车出行
  pro_08: IconSocial,        // 社交聚会
  pro_09: IconCustomer,      // 客服电话
  pro_10: IconDelivery,      // 快递取件
  pro_11: IconGym,           // 健身房
  pro_12: IconHotel,         // 酒店入住
  pro_13: IconPhone,         // 数码店（复用电话表示交易）
  pro_14: IconCampus,        // 论文答辩（校园感）
  pro_15: IconEmergency,     // 在线投诉（紧急感）
};

export const getSceneIcon = (id: string): React.FC<IconProps> => {
  return ICON_BY_ID[id] || IconCompass;
};

// 标题图标
export const IconScenes = IconCompass;
export const IconLearn = IconReport;
