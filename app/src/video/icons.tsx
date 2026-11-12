import {
  IconAlertTriangle, IconAward, IconBolt, IconBook, IconBrain, IconBrandApple, IconBrandFigma, IconBrandFramer, IconBrandGoogle, IconBrandInstagram,
  IconBrandLinkedin, IconBrandNotion, IconBrandOpenai, IconBrandSlack, IconBrandTiktok, IconBrandWindows, IconBrandX, IconBrandYoutube, IconBriefcase,
  IconBuildingBank, IconBulb, IconCalendar, IconCamera, IconCash, IconChartBar, IconCheck, IconClock, IconCode, IconCoffee, IconCreditCard, IconDatabase,
  IconDeviceLaptop, IconEye, IconFileCv, IconFlame, IconFolder, IconGift, IconHeart, IconHome, IconHourglass, IconLayoutDashboard, IconLock, IconMail,
  IconMapPin, IconMessage, IconMicrophone, IconMoneybag, IconMoon, IconMusic, IconPalette, IconPencil, IconPhone, IconPig, IconPlane, IconPuzzle,
  IconQuestionMark, IconRobot, IconRocket, IconRuler, IconSchool, IconSearch, IconSparkles, IconStairs, IconStar, IconSun, IconTarget, IconThumbUp,
  IconTrendingUp, IconTrophy, IconUsers, IconVideo, IconWand, IconWorld,
} from '@tabler/icons-react'

type Ico = typeof IconStar
export const ICONS: Record<string, Ico> = {
  alert: IconAlertTriangle, award: IconAward, bolt: IconBolt, book: IconBook, brain: IconBrain, apple: IconBrandApple, figma: IconBrandFigma, framer: IconBrandFramer,
  google: IconBrandGoogle, instagram: IconBrandInstagram, linkedin: IconBrandLinkedin, notion: IconBrandNotion, openai: IconBrandOpenai, slack: IconBrandSlack,
  tiktok: IconBrandTiktok, microsoft: IconBrandWindows, x: IconBrandX, youtube: IconBrandYoutube, briefcase: IconBriefcase, bank: IconBuildingBank, bulb: IconBulb,
  calendar: IconCalendar, camera: IconCamera, cash: IconCash, chart: IconChartBar, check: IconCheck, clock: IconClock, code: IconCode, coffee: IconCoffee,
  card: IconCreditCard, database: IconDatabase, laptop: IconDeviceLaptop, eye: IconEye, cv: IconFileCv, flame: IconFlame, folder: IconFolder, gift: IconGift,
  heart: IconHeart, home: IconHome, hourglass: IconHourglass, dashboard: IconLayoutDashboard, lock: IconLock, mail: IconMail, pin: IconMapPin, message: IconMessage,
  mic: IconMicrophone, moneybag: IconMoneybag, moon: IconMoon, music: IconMusic, palette: IconPalette, pencil: IconPencil, phone: IconPhone, pig: IconPig,
  plane: IconPlane, puzzle: IconPuzzle, question: IconQuestionMark, robot: IconRobot, rocket: IconRocket, ruler: IconRuler, school: IconSchool, search: IconSearch,
  sparkles: IconSparkles, stairs: IconStairs, star: IconStar, sun: IconSun, target: IconTarget, thumb: IconThumbUp, trend: IconTrendingUp, trophy: IconTrophy,
  users: IconUsers, video: IconVideo, wand: IconWand, world: IconWorld,
}

/** Brands and tools: named in speech, shown as a notification card from that app. */
export const BRANDS: Record<string, { icon: string; name: string; color: string }> = {
  figma: { icon: 'figma', name: 'Figma', color: '#A259FF' }, framer: { icon: 'framer', name: 'Framer', color: '#0055FF' }, notion: { icon: 'notion', name: 'Notion', color: '#14140F' },
  slack: { icon: 'slack', name: 'Slack', color: '#4A154B' }, linkedin: { icon: 'linkedin', name: 'LinkedIn', color: '#0A66C2' }, youtube: { icon: 'youtube', name: 'YouTube', color: '#FF0000' },
  instagram: { icon: 'instagram', name: 'Instagram', color: '#E1306C' }, tiktok: { icon: 'tiktok', name: 'TikTok', color: '#14140F' }, google: { icon: 'google', name: 'Google', color: '#4285F4' },
  microsoft: { icon: 'microsoft', name: 'Microsoft', color: '#0078D4' }, apple: { icon: 'apple', name: 'Apple', color: '#14140F' }, chatgpt: { icon: 'openai', name: 'ChatGPT', color: '#10A37F' },
  openai: { icon: 'openai', name: 'OpenAI', color: '#10A37F' }, claude: { icon: 'sparkles', name: 'Claude', color: '#D97757' }, twitter: { icon: 'x', name: 'X', color: '#14140F' },
  gmail: { icon: 'mail', name: 'Gmail', color: '#EA4335' }, uiland: { icon: 'palette', name: 'Uiland', color: '#6E71E8' }, homalabs: { icon: 'sparkles', name: 'Homalabs', color: '#FB8B73' },
}

/** Word stems → icon. First match wins, so the specific ones come first. */
const STEMS: [RegExp, string][] = [
  [/^(money|cash|paid|pay|salary|income|earn|dollar|naira|pound|\$|₦|£)/i, 'cash'], [/^(save|saving|budget|invest)/i, 'pig'], [/^(bank|loan|debt)/i, 'bank'],
  [/^(rich|wealth|million|billion)/i, 'moneybag'], [/^(card|payment)/i, 'card'],
  [/^(job|jobs|work|career|role|hire|hiring|hired|employ|contract|office|company|full-?time)/i, 'briefcase'], [/^(interview|recruit)/i, 'users'],
  [/^(cv|resume|résumé|application|apply|portfolio|case)/i, 'cv'], [/^(design|designer|designers|ui|ux)/i, 'palette'], [/^(figma|prototype|wireframe)/i, 'pencil'],
  [/^(code|coding|developer|engineer|engineering|build|building)/i, 'code'], [/^(data|database)/i, 'database'], [/^(ai|robot|automat|agent|agents|model)/i, 'robot'],
  [/^(idea|ideas|tip|tips|insight|learn|lesson|lessons)/i, 'bulb'], [/^(strategy|plan|goal|goals|target|focus)/i, 'target'], [/^(grow|growth|scale|increase|more|better)/i, 'trend'],
  [/^(win|won|success|best|result|results)/i, 'trophy'], [/^(time|hour|hours|minute|minutes|fast|quick|deadline)/i, 'clock'], [/^(year|years|month|months|week|weeks|day|days|today|tomorrow)/i, 'calendar'],
  [/^(school|master|masters|degree|study|student|university|graduat|class|classes)/i, 'school'], [/^(move|moved|moving|travel|abroad|canada|toronto|country|relocat)/i, 'plane'],
  [/^(home|house|rent|housing)/i, 'home'], [/^(love|heart|happy|grateful)/i, 'heart'], [/^(team|people|community|network|client|clients|senior|seniors|stakeholder)/i, 'users'],
  [/^(message|dm|chat|reply|comment)/i, 'message'], [/^(email|mail|inbox)/i, 'mail'], [/^(phone|call|calls|apps?)$/i, 'phone'], [/^(video|youtube|content|film)/i, 'video'],
  [/^(camera|photo|picture)/i, 'camera'], [/^(podcast|mic|talk|speak)/i, 'mic'], [/^(laptop|computer|mac|screen)/i, 'laptop'], [/^(search|find|google|look)/i, 'search'],
  [/^(problem|mistake|mistakes|wrong|fail|failed|hard|risk|danger)/i, 'alert'], [/^(secret|private|lock)/i, 'lock'], [/^(brain|think|mind|mindset|smart)/i, 'brain'],
  [/^(launch|start|startup|ship|rocket)/i, 'rocket'], [/^(step|steps|process|journey|level)/i, 'stairs'], [/^(flexib|freedom|side)/i, 'puzzle'], [/^(free|gift|bonus|giveaway)/i, 'gift'],
  [/^(world|global|international)/i, 'world'], [/^(book|read|reading)/i, 'book'], [/^(coffee|morning)/i, 'coffee'], [/^(night|sleep)/i, 'moon'], [/^(magic|easy|simple)/i, 'wand'],
  [/^(chart|metric|metrics|numbers|analytics|performance|impact|outcome|outcomes)/i, 'chart'], [/^(dashboard)/i, 'dashboard'], [/^(award|prize|distinction)/i, 'award'],
  [/^(fire|hot|crazy|insane|huge)/i, 'flame'], [/^(power|energy|boost)/i, 'bolt'], [/^(music|sound|song)/i, 'music'], [/^(folder|file|files|storage|space)/i, 'folder'],
]
export function iconFor(words: string[]): string | null {
  for (const w of words) for (const [re, name] of STEMS) if (re.test(w)) return name
  return null
}
export function brandIn(words: string[]): { icon: string; name: string; color: string } | null {
  for (const w of words) { const b = BRANDS[w.toLowerCase().replace(/[^a-z]/g, '')]; if (b) return b }
  return null
}
export const Icon: React.FC<{ name?: string; size: number; color: string; stroke?: number }> = ({ name, size, color, stroke = 1.8 }) => {
  const C = (name && ICONS[name]) || IconStar
  return <C size={size} color={color} stroke={stroke} />
}
