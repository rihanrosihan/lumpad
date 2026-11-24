// Built-in official timing results by race date (ScoreNow chip splits). Results saved on the Official Result tab live in the synced store
// key 'lumpad.official' ({ 'YYYY-MM-DD': { event, bib, status, net, gun, rank, provider, url, splits } }) and override these field by field.
export const OFFICIAL_RACES = {
  '2026-11-15': {
    event: 'Bank Jateng Borobudur Marathon 2026', bib: '#B13718', status: 'QRY (Black Flag)',
    net: '5:09:15 @ 34K Mat', gun: '5:30:35 (36.92 km)', rank: 'Heat Black Flag · Medal + Jersey',
    provider: 'ScoreNow Official Timing', url: 'https://scorenow.id/',
    splits: [['10K','1:18:59','7:54/km'],['15K','1:59:44','8:09/km'],['21.1K','2:55:25','9:08/km'],['28.4K','4:08:24','10:00/km'],['31.2K','4:42:20','12:07/km'],['34K Mat','5:09:15','9:37/km']],
  },
  '2026-10-25': {
    event: 'HYDROPLUS Jakarta Running Festival FM 2026', bib: '#B13144', status: 'DNF (Pain Gate)',
    net: '0:33:59 @ 5K Mat', gun: '1:03:34 (9.16 km)', rank: 'Disciplined Stop at 2/10 Pain Gate',
    provider: 'ScoreNow Official Timing', url: 'https://scorenow.id/',
    splits: [['5K Mat','0:33:59','6:48/km'],['9.16K Watch','1:03:34','6:56/km']],
  },
  '2026-10-24': {
    event: 'myBCA Jakarta Running Festival HM 2026', bib: '#B24456', status: 'Official Finisher',
    net: '3:07:12', gun: '3:13:40', rank: '11,198 Overall · 6,605 National · 8,499 Male',
    provider: 'ScoreNow Official Timing', url: 'https://scorenow.id/',
    splits: [['5K','0:42:45','8:33/km'],['10K','1:23:04','8:04/km'],['15K','2:08:35','9:06/km'],['20K','2:57:22','9:45/km'],['21.1K Finish','3:07:12','8:56/km']],
  },
  '2026-06-14': {
    event: 'BTN Jakarta International Marathon (Jakim) 2026 · Day 2', bib: '#44708', status: 'Official Finisher · 1st FM · Marathon National',
    net: '6:53:03', gun: '7:03:43', rank: '6,717/8,347 Overall · 5,896/7,221 Gender · 4,127/5,021 Category · net pace 9:48/km, gun pace 10:03/km',
    provider: 'Sporticx Official Timing', url: 'https://result.sporticx.com/result/detail_result/btn-jakim-2026-day-2/44708',
    // checkpoint → cumulative chip time, cumulative average pace (as published; the final 40 km → 42.195 segment is not a published checkpoint)
    splits: [['2.3K','0:18:22','7:59/km'],['5K','0:38:15','7:39/km'],['10K','1:17:52','7:47/km'],['12.63K','1:40:48','7:58/km'],['15K','1:59:44','7:58/km'],['21K','2:57:41','8:27/km'],['24.2K','3:34:07','8:50/km'],['25K','3:42:04','8:52/km'],['30K','4:30:10','9:00/km'],['32.6K','5:03:47','9:19/km'],['35K','5:33:58','9:32/km'],['36.4K','5:44:30','9:27/km'],['37.5K','6:01:29','9:38/km'],['40K','6:28:10','9:42/km'],['42.195K Finish','6:53:03','9:48/km']],
  },
}
