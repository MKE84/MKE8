function main(config) {
    // 检查配置和代理节点是否存在
    if (!config?.proxies || !Array.isArray(config.proxies)) {
        console.warn("未找到代理节点配置");
        return config;
    }

    // 遍历所有代理节点
    config.proxies.forEach(proxy => {
        // 仅处理 VMess/VLESS 节点
        if (proxy.type === 'vmess' || proxy.type === 'vless') {
            const { network = 'tcp' } = proxy; // 默认使用 TCP 协议
            
            // 清理其他协议选项
            ['ws-opts', 'http-opts', 'grpc-opts', 'tcp-opts'].forEach(opt => {
                if (proxy[opt]) delete proxy[opt];
            });

            // 根据协议类型设置混淆参数
            switch (network) {
                case 'ws':
                    proxy.network = 'ws';
                    proxy['ws-opts'] = {
                        path: '/',
                        headers: { Host: 'm.iqiyi.com' }
                    };
                    break;
                case 'http':
                    proxy.network = 'http';
                    proxy['http-opts'] = {
                        method: 'GET',
                        path: ['/'],
                        headers: { Host: ['m.iqiyi.com'] } // Host 为数组
                    };
                    break;
                case 'tcp':
                default:
                    proxy.network = 'tcp';
                    proxy['tcp-opts'] = {
                        headers: { Host: 'm.iqiyi.com' } // Host 为字符串
                    };
                    break;
            }

            // 确保 TLS 设置
            proxy.tls = proxy.tls || false;
        }
    });

    // 添加出站规则（如果尚未存在）
    const outboundProxies = [
        { name: "DNS_Hijack", type: "dns" },
        { name: "局域网", type: "http", server: "10.0.0.200", port: 80 }
    ];
    
    outboundProxies.forEach(outbound => {
        if (!config.proxies.some(p => p.name === outbound.name)) {
            config.proxies.push(outbound);
        }
    });
/*
  // HTTP(S) 和 SOCKS 代理混合端口
  config['mixed-port'] = 7890;
  // 透明代理端口，用于 Linux 和 MacOS
  config['redir-port'] = 9797;
  // 适用于 Linux 的透明代理服务器端口（TProxy TCP 和 TProxy UDP）
  config['tproxy-port'] = 9898;
  // 允许局域网，允许其他设备经过 Clash 的代理端口访问互联网
  config['allow-lan'] = true;
  // always 强制匹配所有进程 / strict 由 mihomo 判断是否开启 / off 不匹配进程，推荐在路由器上使用此模式
  config['find-process-mode'] = 'always';
  // 运行模式，rule 规则匹配 / global 全局代理 (需要在 GLOBAL 策略组选择代理/策略) / direct 全局直连
  config.mode = 'rule';
  // 日志等级，silent：静默，不输出 / error：仅输出发生错误至无法使用的日志 / warning：输出发生错误但不影响运行的日志，以及 error 级别内容 / info：输出一般运行的内容，以及 error 和 warning 级别的日志 / debug：尽可能的输出运行中所有的信息
  config['log-level'] = 'info';
  // 开启 IPv6 总开关，关闭阻断所有 IPv6 链接和屏蔽 DNS 请求 AAAA 记录
  config.ipv6 = false;
  // 统一延迟，开启统一延迟时，会计算 RTT，以消除连接握手等带来的不同类型节点的延迟差异 可选值 true/false
  config['unified-delay'] = true;
  // TCP 并发连接所有 IP, 将使用最快握手的 TCP
  config['tcp-concurrent'] = true;
  // 自定义外部资源下载时使用的的 UA，默认为 clash.meta
  config['global-ua'] = 'clash-verge/v2.4.2';

  // TCP Keep Alive 设置，修改此项以减少移动设备耗电问题
  config['keep-alive-interval'] = 30; // TCP Keep Alive 包的间隔，单位为秒
  config['keep-alive-idle'] = 15; // TCP Keep Alive 的最大空闲时间
  config['disable-keep-alive'] = false; // 禁用 TCP Keep Alive，在 Android 默认为 true

  // 外部控制 (API)，外部控制器，可以使用 RESTful API 来控制你的 Clash 内核
  config['external-controller'] = '0.0.0.0:9090';
  // API 的访问密钥
  config.secret = '';
  // 外部用户界面，可以将静态网页资源（比如 Clash-dashboard) 运行在 Clash API, 路径为 API 地址/ui。可以为绝对路径，或者 Clash 工作目录的相对路径
  config['external-ui'] = 'ui';
  // 自定义外部用户界面下载地址
  config['external-ui-url'] = 'https://ghfast.top/https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip';

  config.profile = {
    // 存储 select 选择记录
    'store-selected': true,
    // 持久化 fake-ip，域名再次发生连接时，使用原有映射地址
    'store-fake-ip': true
  };

  config.sniffer = {
    enable: true,
    'force-dns-mapping': true,
    'parse-pure-ip': true,
    'override-destination': true,
    sniff: {
      HTTP: {
        ports: [80, '8080-8880']
      },
      TLS: {
        ports: [443, 5228, 8443]
      },
      QUIC: {
        ports: [443, 8443]
      }
    },
    'force-domain': ['+.v2ex.com'],
    'skip-domain': ['Mijia Cloud', 'dlg.io.mi.com', '+.push.apple.com']
  };

  config.hosts = {
    'doh.pub': ['1.12.12.12', '120.53.53.53', '2402:4e00::'],
    'dns.alidns.com': ['223.5.5.5', '223.6.6.6', '2400:3200::1', '2400:3200:baba::1'],
    'dns.google': ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844'],
    'one.one.one.one': ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001'],
    // 去广告 DNS
    'dns.18bit.cn': ['42.51.13.218', '42.51.37.204', '47.109.110.36', '115.190.191.220'],
    'dns.ipv4dns.com': ['171.80.2.155', '171.80.2.166']
  };

  config.dns = {
    enable: true,
    'cache-algorithm': 'arc',
    'respect-rules': true,
    listen: '0.0.0.0:1053',
    ipv6: true,
    'default-nameserver': [
      '114.114.114.114',
      '8.8.8.8'
    ],
    'enhanced-mode': 'fake-ip', // or redir-host
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-range6': 'fdfe:dcba:9876::1/64',
    'fake-ip-filter': [
      'rule-set:排除域名'
    ],
    'fake-ip-ttl': 1,
    nameserver: [
      'https://dns.google/dns-query',
      'https://one.one.one.one/dns-query'
    ],
    'nameserver-policy': {
      '+.googleapis.cn,+.intlgame.com,+.mypikpak.net,+.mypikpak.com,+.right.com.cn': [
        'https://dns.google/dns-query',
        'https://one.one.one.one/dns-query'
      ],
      '+.dlproxy.uk,+.xajtl.com,+.steamcontent.com,+.xn--qfsx5xvnik06b.com': [
        'https://doh.pub/dns-query',
        'https://dns.alidns.com/dns-query'
      ],
      'rule-set:大陆域名': [
        'https://doh.pub/dns-query',
        'https://dns.alidns.com/dns-query'
      ]
    },
    'proxy-server-nameserver': [
      'https://doh.pub/dns-query#出站上游',
      'https://dns.alidns.com/dns-query#出站上游'
    ],
    'direct-nameserver': [
      'udp://223.5.5.5',
      'udp://119.29.29.29',
      'udp://114.114.114.114'
    ]
  };

  const providers = {interval: 3600, proxy: '国外出口', 'health-check': {enable: true, url: 'https://www.gstatic.com/generate_204', interval: 86400, timeout: 8000}};
  config['proxy-providers'] = {
    '白嫖订阅': {
      ...providers,
      type: 'http',
      path: './proxies/白嫖订阅.yaml',
      url: 'https://raw.githubusercontent.com/go4sharing/sub/main/sub.yaml',
      override: {'additional-prefix': '白嫖订阅/', 'dialer-proxy': '出站上游'}
    },
    '百度直连': {
      ...providers,
      type: 'http',
      path: './proxies/百度直连.yaml',
      url: 'https://gist.githubusercontent.com/jieluojun/d4b528ee3418740112357a80e940d912/raw/BaiduDirect',
      override: {'additional-prefix': '百度直连/'},
      filter: '电信'
    },
    '彩信直连': {
      ...providers,
      type: 'file',
      path: './proxies/百度直连.yaml',
      override: {'additional-prefix': '彩信直连/', 'dialer-proxy': '局域网'},
      filter: '电信'
    }
  };

  config['proxy-groups'] = [
    {
      name: '国外出口',
      type: 'select',
      proxies: [
        '负载均衡',
        '国内出口'
      ],
      'include-all-proxies': true,
      'include-all-providers': true,
      'exclude-filter': '🇨🇳|家宽|江苏|镇江|浙江|杭州|常州|南京|北京|上海|广东|广州|苏州|杭州|福州|扬州|贵州|兰州|徐州|郑州|广西|河南|河北|重庆|南宁|宿迁|沈阳|四川|安徽|深圳|辽宁|济南|九江|长沙|昆明|武汉|陕西|西宁|芜湖|天津|南昌|成都|山西|太原|保定|湖南|湖北|德阳|山东|十堰|青岛|合肥|内蒙古',
      'exclude-type': 'Hysteria2' // https://github.com/MetaCubeX/mihomo/blob/fbead56ec97ae93f904f4476df1741af718c9c2a/constant/adapters.go#L18-L45
    },
    {
      name: '国内出口',
      type: 'select',
      proxies: [
        '出站上游',
        'DIRECT'
      ],
      'include-all-proxies': true,
      filter: '🇨🇳|家宽|江苏|镇江|浙江|杭州|常州|南京|北京|上海|广东|广州|苏州|杭州|福州|扬州|贵州|兰州|徐州|郑州|广西|河南|河北|重庆|南宁|宿迁|沈阳|四川|安徽|深圳|辽宁|济南|九江|长沙|昆明|武汉|陕西|西宁|芜湖|天津|南昌|成都|山西|太原|保定|湖南|湖北|德阳|山东|十堰|青岛|合肥|内蒙古'
    },
    {
      name: '腾讯游戏',
      type: 'select',
      proxies: [
        'DIRECT',
        'PASS'
      ],
      'include-all-proxies': true,
      filter: '🇨🇳|家宽|国内|江苏|镇江|浙江|杭州|常州|南京|北京|上海|广东|广州|苏州|杭州|福州|扬州|贵州|兰州|徐州|郑州|广西|河南|河北|重庆|南宁|宿迁|沈阳|四川|安徽|深圳|辽宁|济南|九江|长沙|昆明|武汉|陕西|西宁|芜湖|天津|南昌|成都|山西|太原|保定|湖南|湖北|德阳|山东|十堰|青岛|合肥|内蒙古',
      'exclude-type': 'Shadowsocks|Socks5|Http'
    },
    {
      name: 'UDP出口',
      type: 'select',
      proxies: [
        'PASS',
        'DIRECT'
      ],
      'include-all-proxies': true,
      filter: '🇨🇳|家宽|国内|江苏|镇江|浙江|杭州|常州|南京|北京|上海|广东|广州|苏州|杭州|福州|扬州|贵州|兰州|徐州|郑州|广西|河南|河北|重庆|南宁|宿迁|沈阳|四川|安徽|深圳|辽宁|济南|九江|长沙|昆明|武汉|陕西|西宁|芜湖|天津|南昌|成都|山西|太原|保定|湖南|湖北|德阳|山东|十堰|青岛|合肥|内蒙古',
      'exclude-type': 'Shadowsocks|Socks5|Http' // https://github.com/MetaCubeX/mihomo/blob/fbead56ec97ae93f904f4476df1741af718c9c2a/constant/adapters.go#L18-L45
    },
    {
      name: '广告出口',
      type: 'select',
      proxies: [
        'PASS',
        'REJECT-DROP'
      ]
    },
    {
      name: '出站上游',
      type: 'select',
      proxies: [
        '百度直连',
        '彩信直连'
      ]
    },
    {
      name: '百度直连',
      type: 'load-balance',
      use: [
        '百度直连'
      ],
      strategy: 'round-robin'
    },
    {
      name: '彩信直连',
      type: 'load-balance',
      use: [
        '彩信直连'
      ],
      strategy: 'round-robin'
    },
    {
      name: '负载均衡',
      type: 'load-balance',
      'include-all-proxies': true,
      'include-all-providers': false,
      filter: '(?i)🇭🇰|🇹🇼|🇰🇷|🇺🇸|🇸🇬|香港|台湾|韩国|美国|新加坡|HK|TW|KR|US|SG',
      strategy: 'round-robin'
    }
  ];

  const rule = {type: 'http', interval: 86400, proxy: '国外出口', format: 'mrs'};
  config['rule-providers'] = {
    '排除域名': {
      ...rule,
      behavior: 'domain',
      url: 'https://ghfast.top/https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/fakeip-filter.mrs'
    },
    '广告域名': {
      ...rule,
      behavior: 'domain',
      url: 'https://ghfast.top/https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/ads.mrs'
    },
    '大陆域名': {
      ...rule,
      behavior: 'domain',
      url: 'https://ghfast.top/https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/cn.mrs'
    },
    '大陆地址': {
      ...rule,
      behavior: 'ipcidr',
      url: 'https://ghfast.top/https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/cnip.mrs'
    },
    '本地地址': {
      ...rule,
      behavior: 'ipcidr',
      url: 'https://ghfast.top/https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/privateip.mrs'
    }
  };

  config.rules = [
    'DST-PORT,53,DNS_Hijack',
    'OR,(DOMAIN-KEYWORD,p2p),(DOMAIN-KEYWORD,stun),(DOMAIN-KEYWORD,pcdn),(DOMAIN-KEYWORD,mcdn),(DOMAIN-KEYWORD,torrent),(DOMAIN-KEYWORD,tracker),(DOMAIN-KEYWORD,httpdns),(DOMAIN-KEYWORD,playstation),REJECT-DROP',
    'OR,(DOMAIN,wswup.cdn.huya.com),(DOMAIN,cdnws.api.huya.com),REJECT-DROP',
    'AND,(NETWORK,UDP),(OR,((DST-PORT,443/3478/5349),(RULE-SET,本地地址))),REJECT-DROP',
    'AND,(NETWORK,UDP),(IP-CIDR,14.22.2.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,14.22.5.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,14.22.9.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,14.29.103.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,42.81.179.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,42.81.242.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,42.187.183.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,101.91.22.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,101.91.33.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,101.226.95.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,101.226.96.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,101.226.153.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,106.55.117.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,106.55.184.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,110.40.162.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,111.31.201.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.96.16.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.249.144.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.249.145.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.250.7.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.250.8.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.250.9.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,113.250.24.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,114.230.196.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,116.130.230.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,117.68.25.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,117.68.26.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,117.89.181.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,117.135.156.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,121.229.88.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,123.151.48.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,123.151.68.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,123.151.69.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,123.151.54.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,139.186.239.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,140.206.161.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,140.249.77.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,140.249.80.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,140.249.81.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,150.139.159.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,175.27.13.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,180.102.58.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,180.102.59.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,180.102.99.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,180.102.111.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,180.102.190.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,180.110.152.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,182.40.48.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,183.47.102.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,183.47.103.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,183.47.104.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,183.47.111.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,183.47.112.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(IP-CIDR,222.94.109.0/24),腾讯游戏',
    'AND,(NETWORK,UDP),(DST-PORT,1-65535),UDP出口',
    'OR,(DST-PORT,446),(DOMAIN-SUFFIX,googleapis.cn),(DOMAIN-SUFFIX,intlgame.com),(DOMAIN-SUFFIX,mypikpak.net),(DOMAIN-SUFFIX,mypikpak.com),(DOMAIN-SUFFIX,right.com.cn),国外出口',
    'OR,(DOMAIN-SUFFIX,dlproxy.uk),(DOMAIN-SUFFIX,xajtl.com),(DOMAIN-SUFFIX,steamcontent.com),(DOMAIN-SUFFIX,xn--qfsx5xvnik06b.com),国内出口',
    'RULE-SET,广告域名,广告出口',
    'RULE-SET,本地地址,DIRECT',
    'RULE-SET,大陆域名,国内出口',
    'RULE-SET,大陆地址,国内出口',
    'MATCH,国外出口',
    'MATCH,REJECT'
  ];
*/
  return config;
}