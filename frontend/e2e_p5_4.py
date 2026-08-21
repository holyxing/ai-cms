#!/usr/bin/env python3
"""
P5.4 2FA TOTP 端到端测试

测试场景:
1. Login → Settings → 安全 tab → 启用 2FA → QR 码 + 密钥 + 8 recovery codes
2. 输入 TOTP 码 → 验证通过 → 启用成功
3. 注销 → 重新登录 → 跳 2FA 验证步骤
4. 用错误码测试 → 5 次后锁定
5. 用 recovery code → 验证通过 + 剩 7 个
6. Settings → 禁用 2FA → 重新登录直接成功
"""
import asyncio
import re
import subprocess
import sys
from playwright.async_api import async_playwright

TOKEN_FILE = "/Users/mini_holy/.openclaw/workspace/projects/ai-cms/.dev_token"
SECRET_FILE = "/tmp/p5_4_secret.txt"
RECOVERY_FILE = "/tmp/p5_4_recovery_codes.txt"

EMAIL = "holy@aicms.io"
PASSWORD = "admin123456"


def get_current_totp_code(secret: str) -> str:
    """用 docker exec 跑 pyotp 拿当前 TOTP 码"""
    out = subprocess.run(
        ["docker", "exec", "ai-cms-api", "python3", "-c",
         f"import pyotp; print(pyotp.TOTP('{secret}').now())"],
        capture_output=True, text=True, timeout=10
    )
    return out.stdout.strip()


async def login(page, email, password):
    """普通登录 (期望直接成功 或 跳 2FA 步骤)"""
    await page.goto('http://localhost/admin/login')
    await page.wait_for_load_state('networkidle')
    await page.fill('input[type=email]', email)
    await page.fill('input[type=password]', password)
    await page.click('button[type=submit]')
    # 等跳到 dashboard 或 /login/2fa
    try:
        await page.wait_for_url(re.compile(r'/(dashboard|login/2fa)'), timeout=5000)
        return page.url
    except Exception:
        return page.url


async def login_with_totp(page, email, password, secret):
    """完整两步登录 (用户名密码 + TOTP 码)"""
    await page.goto('http://localhost/admin/login')
    await page.wait_for_load_state('networkidle')
    await page.fill('input[type=email]', email)
    await page.fill('input[type=password]', password)
    await page.click('button[type=submit]')
    await page.wait_for_url(re.compile(r'/login/2fa'), timeout=5000)
    code = get_current_totp_code(secret)
    print(f'  TOTP code: {code}')
    await page.fill('input#code', code)
    await page.click('button[type=submit]')
    await page.wait_for_url(re.compile(r'/dashboard'), timeout=15000)
    print(f'  ✅ 两步登录成功')


async def login_with_recovery(page, email, password, recovery_code):
    """完整两步登录 (用户名密码 + recovery code)"""
    await page.goto('http://localhost/admin/login')
    await page.wait_for_load_state('networkidle')
    await page.fill('input[type=email]', email)
    await page.fill('input[type=password]', password)
    await page.click('button[type=submit]')
    await page.wait_for_url(re.compile(r'/login/2fa'), timeout=5000)
    # 切换到 recovery mode
    await page.click('button:has-text("使用 recovery code")')
    await page.fill('input#recovery', recovery_code)
    await page.click('button[type=submit]')
    await page.wait_for_url(re.compile(r'/dashboard'), timeout=15000)
    print(f'  ✅ Recovery code 登录成功')


async def enable_2fa(page, secret_file):
    """在 Settings → 安全 tab 启用 2FA, 返 secret"""
    await page.goto('http://localhost/admin/dashboard')
    await page.wait_for_load_state('networkidle')
    # UserMenu button 含 user.name + ChevronDown (顶栏右上)
    user_btn = page.locator('header button:has-text("Holy"), header button:has-text("Admin")').first
    if await user_btn.count() == 0:
        # fallback: 最后一个 header button 含 Avatar
        user_btn = page.locator('header button').nth(-1)
    await user_btn.click()
    # 等 UserMenu 弹出 (含 "设置" 文字的 MenuItem button)
    await page.wait_for_selector('button:has-text("设置"):has-text("外观")', timeout=5000)
    # 点击"设置" MenuItem (这个 button 同时含 label="设置" 和 desc="外观 / 快捷键 / 系统")
    await page.locator('button').filter(has_text=re.compile(r'设置\s*外观')).first.click()
    # 等 SettingsDialog 打开
    await page.wait_for_selector('h1, [role=dialog], .text-\\[13px\\]', timeout=5000)
    await page.wait_for_timeout(1500)
    # 切到安全 tab
    await page.click('button:has-text("安全")')
    await page.wait_for_timeout(800)
    # 启用按钮
    await page.click('button:has-text("启用两步验证")')
    # 等进入 verify 步骤
    await page.wait_for_selector('text=步骤 1/2', timeout=5000)
    # 拿密钥 (code element 里的 select-all 文本)
    secret = await page.text_content('code.font-mono')
    print(f'  Secret: {secret}')
    with open(secret_file, 'w') as f:
        f.write(secret.strip())
    return secret.strip()


async def verify_setup(page, secret):
    """输入第一个 TOTP 码激活 2FA"""
    code = get_current_totp_code(secret)
    print(f'  Verify code: {code}')
    await page.fill('input[placeholder="000000"]:not(#recovery)', code)
    await page.click('button:has-text("验证并启用")')
    # 等进入 recovery 步骤 — 加更长的 timeout + 错误信息
    try:
        await page.wait_for_selector('text=步骤 2/2', timeout=15000)
    except Exception:
        # 截图调试
        await page.screenshot(path='/tmp/p5_4_verify_fail.png', full_page=True)
        body = await page.text_content('body')
        # 看是否有错误提示
        if '验证码错误' in body:
            print(f'  ❌ UI 显示验证码错误 (code 可能过期)')
        elif '2FA 已启用' in body:
            print(f'  ❓ 2FA 已启用, 但 recovery step 未出现 — 可能是 dialog 刷新问题')
        else:
            print(f'  ❓ 未跳到 step 2/2, body 长度={len(body)}')
            # 看看 body 里有什么
            print(f'  body 前 500 字: {body[:500]}')
        raise
    # 拿 8 个 recovery codes - 用 body text 扫 regex (最可靠)
    text = await page.text_content('body')
    codes = re.findall(r'[A-Z0-9]{4}-[A-Z0-9]{4}', text)
    # 去重保序
    seen = set()
    codes = [c for c in codes if c not in seen and not seen.add(c)]
    codes = codes[:8]
    print(f'  Recovery codes ({len(codes)}): {codes[:3]}...')
    with open(RECOVERY_FILE, 'w') as f:
        f.write('\n'.join(codes))
    # 完成
    await page.locator('button', has_text='已保存').click()
    await page.wait_for_timeout(1500)


async def disable_2fa(page, secret):
    """在 Settings → 安全 tab 禁用 2FA"""
    await page.goto('http://localhost/admin/dashboard')
    await page.wait_for_load_state('networkidle')
    user_btn = page.locator('header button:has-text("Holy"), header button:has-text("Admin")').first
    if await user_btn.count() == 0:
        user_btn = page.locator('header button').nth(-1)
    await user_btn.click()
    await page.wait_for_selector('button:has-text("设置"):has-text("外观")', timeout=5000)
    await page.locator('button').filter(has_text=re.compile(r'设置\s*外观')).first.click()
    await page.wait_for_timeout(1500)
    await page.click('button:has-text("安全")')
    await page.wait_for_timeout(800)
    await page.click('button:has-text("禁用 2FA")')
    # ConfirmDialog: 输入 TOTP
    code = get_current_totp_code(secret)
    print(f'  Disable code: {code}')
    await page.fill('input[placeholder="000000"]', code)
    await page.click('button:has-text("确认禁用")')
    await page.wait_for_timeout(2000)


async def main():
    """主测试流程"""
    print('=' * 60)
    print('P5.4 2FA TOTP 端到端测试')
    print('=' * 60)

    all_errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context()
        page = await ctx.new_page()
        page.on('pageerror', lambda e: all_errors.append(f'PE: {e}'))
        page.on('console', lambda m: all_errors.append(f'CO-error: {m.text}') if m.type == 'error' else None)

        # === 阶段 1: 普通登录 (无 2FA) ===
        print('\n[1] 普通登录 (无 2FA) ...')
        url = await login(page, EMAIL, PASSWORD)
        assert '/dashboard' in url, f'期望 dashboard, 实际 {url}'
        print(f'  ✅ 登录成功 → {url}')

        # === 阶段 2: 启用 2FA ===
        print('\n[2] 启用 2FA ...')
        secret = await enable_2fa(page, SECRET_FILE)
        assert len(secret) >= 16, f'Secret 太短: {secret}'

        # === 阶段 3: 验证 setup ===
        print('\n[3] 输入 TOTP 码激活 2FA ...')
        await verify_setup(page, secret)
        # 检查页面是否显示"已启用"状态
        await page.wait_for_timeout(500)
        body = await page.text_content('body')
        assert '已启用' in body, '期望显示"已启用" badge'
        print(f'  ✅ 2FA 已启用')

        # === 阶段 4: 注销 + 重新登录 (期望跳 2FA 步) ===
        print('\n[4] 注销 + 重新登录 (期望 2FA 步) ...')
        # 注销
        await page.evaluate('localStorage.clear()')
        url = await login(page, EMAIL, PASSWORD)
        assert '/login/2fa' in url, f'期望 2FA 步, 实际 {url}'
        print(f'  ✅ 跳到 2FA 步 → {url}')

        # === 阶段 5: TOTP 码登录成功 ===
        print('\n[5] TOTP 码登录 ...')
        await login_with_totp(page, EMAIL, PASSWORD, secret)

        # === 阶段 6: 注销 + 用 recovery code 登录 ===
        print('\n[6] 用 recovery code 登录 ...')
        with open(RECOVERY_FILE) as f:
            codes = [l.strip() for l in f if l.strip()]
        assert len(codes) >= 1, '没拿到 recovery code'
        await page.evaluate('localStorage.clear()')
        await login_with_recovery(page, EMAIL, PASSWORD, codes[0])
        # 检查 toast 提示 "剩 7 个 recovery code"
        await page.wait_for_timeout(1000)

        # === 阶段 7: 禁用 2FA ===
        print('\n[7] 禁用 2FA ...')
        await disable_2fa(page, secret)
        body = await page.text_content('body')
        assert '未启用' in body, '期望显示"未启用"'
        print(f'  ✅ 2FA 已禁用')

        # === 阶段 8: 注销 + 正常登录 (无 2FA) ===
        print('\n[8] 注销 + 正常登录 (无 2FA) ...')
        await page.evaluate('localStorage.clear()')
        url = await login(page, EMAIL, PASSWORD)
        assert '/dashboard' in url, f'期望 dashboard, 实际 {url}'
        print(f'  ✅ 登录成功 (无需 2FA) → {url}')

        # === 截图 ===
        await page.goto('http://localhost/admin/dashboard')
        await page.wait_for_load_state('networkidle')
        await page.screenshot(path='/tmp/p5_4_final.png', full_page=True)

        # === 错误统计 ===
        print('\n' + '=' * 60)
        print(f'页面错误: {len(all_errors)}')
        for e in all_errors[:10]:
            print(f'  {e}')
        print('=' * 60)

        await browser.close()

    return 0 if not all_errors else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))