# AI-CMS 备份服务 (PG → MinIO)
# 依据: docs/05-开发路线图.md P4 (备份脚本)

# 用国内镜像拉 base, 避免 docker hub timeout
FROM docker.m.daocloud.io/library/alpine:3.20

RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apk/repositories

RUN apk add --no-cache \
    bash \
    postgresql16-client \
    curl \
    gzip \
    tzdata

# mc
ARG MC_VERSION="RELEASE.2024-11-21T17-21-54Z"
RUN curl -fsSL "https://dl.min.io/client/mc/release/linux-amd64/archive/mc.${MC_VERSION}" \
    -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc

# supercronic
ARG SUPERCRONIC_VERSION="v0.2.33"
RUN curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
    -o /usr/local/bin/supercronic && chmod +x /usr/local/bin/supercronic

ENV TZ=Asia/Shanghai
COPY crontab /etc/crontab.backup
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh && mkdir -p /var/log

CMD ["supercronic", "/etc/crontab.backup"]
