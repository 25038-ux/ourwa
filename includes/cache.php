<?php
/**
 * Cache léger pour El OURWA.
 *
 * Backends supportés (auto-détection) :
 *   1. APCu (recommandé pour single-server) — extension PHP standard
 *   2. Redis (recommandé multi-server)      — si l'extension est installée
 *   3. Fallback "no-op" (pas de cache)      — l'app fonctionne quand même
 *
 * Usage :
 *   $val = cache_get('cle');
 *   if ($val === null) {
 *       $val = ... // calcul coûteux
 *       cache_set('cle', $val, 600); // TTL en secondes
 *   }
 *
 *   cache_remember('cle', 600, fn() => ...);
 *   cache_forget('cle');
 *   cache_forget_prefix('niveaux:');
 */

class CacheBackend {
    public static ?CacheBackend $instance = null;

    private string $driver;
    private $redis = null;

    public function __construct() {
        // Variables d'environnement (peuvent être définies en haut de bootstrap.php)
        $force = getenv('EDU_CACHE_DRIVER') ?: '';

        if (($force === '' || $force === 'redis') && extension_loaded('redis')) {
            try {
                $r = new Redis();
                $host = getenv('REDIS_HOST') ?: '127.0.0.1';
                $port = (int)(getenv('REDIS_PORT') ?: 6379);
                $r->connect($host, $port, 0.5);
                $pass = getenv('REDIS_PASS') ?: '';
                if ($pass) $r->auth($pass);
                $this->redis  = $r;
                $this->driver = 'redis';
                return;
            } catch (Throwable $e) { /* fallback APCu */ }
        }
        if (($force === '' || $force === 'apcu') && function_exists('apcu_enabled') && apcu_enabled()) {
            $this->driver = 'apcu';
            return;
        }
        $this->driver = 'none';
    }

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    public function driver(): string { return $this->driver; }

    public function get(string $key) {
        switch ($this->driver) {
            case 'apcu':
                $ok = false;
                $v  = apcu_fetch($key, $ok);
                return $ok ? $v : null;
            case 'redis':
                $v = $this->redis->get($key);
                return $v === false ? null : @unserialize($v);
            default:
                return null;
        }
    }

    public function set(string $key, $value, int $ttl = 600): bool {
        switch ($this->driver) {
            case 'apcu':  return apcu_store($key, $value, $ttl);
            case 'redis': return (bool) $this->redis->setex($key, $ttl, serialize($value));
            default:      return false;
        }
    }

    public function forget(string $key): bool {
        switch ($this->driver) {
            case 'apcu':  return (bool) apcu_delete($key);
            case 'redis': return (bool) $this->redis->del($key);
            default:      return true;
        }
    }

    public function forget_prefix(string $prefix): int {
        $count = 0;
        switch ($this->driver) {
            case 'apcu':
                $iter = new APCUIterator('/^' . preg_quote($prefix, '/') . '/');
                foreach ($iter as $entry) {
                    if (apcu_delete($entry['key'])) $count++;
                }
                break;
            case 'redis':
                $cursor = 0;
                do {
                    $keys = $this->redis->scan($cursor, $prefix . '*', 200);
                    if ($keys) {
                        $count += (int) $this->redis->del($keys);
                    }
                } while ($cursor > 0);
                break;
        }
        return $count;
    }
}

function cache_get(string $key) {
    return CacheBackend::instance()->get($key);
}
function cache_set(string $key, $value, int $ttl = 600): bool {
    return CacheBackend::instance()->set($key, $value, $ttl);
}
function cache_forget(string $key): bool {
    return CacheBackend::instance()->forget($key);
}
function cache_forget_prefix(string $prefix): int {
    return CacheBackend::instance()->forget_prefix($prefix);
}
function cache_remember(string $key, int $ttl, callable $producer) {
    $v = cache_get($key);
    if ($v !== null) return $v;
    $v = $producer();
    cache_set($key, $v, $ttl);
    return $v;
}
function cache_driver(): string {
    return CacheBackend::instance()->driver();
}
