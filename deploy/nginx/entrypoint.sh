#!/bin/sh
# B5 inotify auto-reload: 当 sites.map 改变时自动 reload nginx
# 在后台运行, 不阻塞 nginx 主进程

# 确保 map 文件存在
mkdir -p /etc/nginx/conf.d
touch /etc/nginx/conf.d/sites.map
# 跨容器: api 容器 (uid=1000) + nginx 容器 (uid=0)
# 解决方法: 改 conf.d 权限为 777, 这样任何进程都能读写
chmod -R 777 /etc/nginx/conf.d/

# 装 inotify-tools (apk)
if ! command -v inotifywait >/dev/null 2>&1; then
  apk add --no-cache inotify-tools >/dev/null 2>&1
fi

# 后台监听
(
  inotifywait -m -e modify,create,close_write,move /etc/nginx/conf.d/sites.map 2>/dev/null |
  while read -r path _event _file; do
    # 防抖: 200ms 内多次修改只 reload 一次
    sleep 0.2
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null && \
      echo "[$(date -Iseconds)] nginx reloaded (map changed)" || \
      echo "[$(date -Iseconds)] nginx reload FAILED (config test fail)" >&2
  done
) &

# 跑默认 entrypoint
exec "$@"
