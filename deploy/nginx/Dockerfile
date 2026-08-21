FROM nginx:1.27-alpine

# 用清华 TUNA 镜像 (Day 8 经验: alpine 默认源在 macOS docker 上不稳)
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apk/repositories

# 装 inotify-tools 用于 B5 host-based map 自动 reload
RUN apk add --no-cache inotify-tools

# 复制 entrypoint (B5 inotify 监听)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
