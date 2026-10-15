// 唯一的共享转发收件箱地址
export const SHARED_INBOX = 'inbox@vpass.cc';

// 域名列表接口使用的静态 SQL。json_each 只接收合法数组；数组里的非对象元素
// 通过 CASE 变成 NULL，避免 json_extract('dirty', '$.address') 抛 malformed JSON。
const guardedRecipient = `CASE
	WHEN json_valid(recipient) AND json_type(recipient) = 'array' THEN recipient
	ELSE '[]'
END`;
const recipientAddress = `CASE
	WHEN recipient_item.type = 'object' THEN json_extract(recipient_item.value, '$.address')
	ELSE NULL
END`;
const addressDomain = address => `lower(substr(trim(${address}), instr(trim(${address}), '@') + 1))`;

export const ALL_EMAIL_DOMAINS_SQL = `SELECT DISTINCT domain FROM (
	SELECT ${addressDomain('to_email')} AS domain
	FROM email
	WHERE instr(trim(to_email), '@') > 0
		AND NOT (
			lower(trim(to_email)) = '${SHARED_INBOX}'
			AND EXISTS (
				SELECT 1
				FROM json_each(${guardedRecipient}) AS recipient_item
				WHERE instr(trim(${recipientAddress}), '@') > 0
					AND length(${addressDomain(recipientAddress)}) > 0
			)
		)
	UNION
	SELECT ${addressDomain(recipientAddress)} AS domain
	FROM email, json_each(${guardedRecipient}) AS recipient_item
	WHERE lower(trim(to_email)) = '${SHARED_INBOX}'
		AND instr(trim(${recipientAddress}), '@') > 0
		AND length(${addressDomain(recipientAddress)}) > 0
)
WHERE domain IS NOT NULL AND domain <> ''
ORDER BY domain`;

/**
 * 规范化域名：trim + 转小写，空值返回 ''
 */
function normalizeDomain(domain) {
	if (typeof domain !== 'string') return '';
	return domain.trim().toLowerCase();
}

/**
 * 从邮箱地址中取出小写域名，取不到返回 ''
 */
function emailToDomain(emailAddress) {
	if (typeof emailAddress !== 'string') return '';
	const parts = emailAddress.trim().split('@');
	return parts.length === 2 ? normalizeDomain(parts[1]) : '';
}

/**
 * 解析 recipient JSON 字符串，返回其中有效地址对应的小写域名数组（去重）。
 * JSON 缺失、非法、空、或无有效地址时返回空数组。
 */
function parseRecipientDomains(recipient) {
	if (typeof recipient !== 'string' || recipient.trim() === '') {
		return [];
	}

	let parsed;
	try {
		parsed = JSON.parse(recipient);
	} catch (e) {
		return [];
	}

	if (!Array.isArray(parsed)) {
		return [];
	}

	const domains = [];
	for (const item of parsed) {
		if (!item || typeof item.address !== 'string') {
			continue;
		}
		const domain = emailToDomain(item.address);
		if (domain && !domains.includes(domain)) {
			domains.push(domain);
		}
	}
	return domains;
}

/**
 * 统一转收邮件在管理端展示原始收件地址；其他邮件保持实际 toEmail。
 * recipient 缺失、格式错误或没有有效地址时安全回退。
 */
export function displayToEmail({ toEmail, recipient }) {
	if (normalizeDomain(toEmail) !== SHARED_INBOX) {
		return toEmail || '';
	}

	if (typeof recipient !== 'string' || recipient.trim() === '') {
		return toEmail || '';
	}

	try {
		const parsed = JSON.parse(recipient);
		if (!Array.isArray(parsed)) return toEmail || '';
		const first = parsed.find(item => {
			return item && typeof item.address === 'string' && emailToDomain(item.address);
		});
		return first ? first.address.trim() : (toEmail || '');
	} catch (e) {
		return toEmail || '';
	}
}

/**
 * 根据既定分类规则，返回一封邮件归属的所有来源域名（小写、去重）。
 *
 * 规则：
 * 1. toEmail 为共享收件箱 inbox@vpass.cc 时，使用 recipient[].address 的域名（可能多个）。
 * 2. toEmail 为其他地址时，按 toEmail 的域名分类，不看 recipient。
 * 3. 共享收件箱但 recipient 缺失/非法/空/无有效域名时，回退到 toEmail 的域名（vpass.cc）。
 * 4. 大小写不敏感精确匹配。绝不使用 sendEmail 或 userEmail。
 */
function classifyDomains({ toEmail, recipient }) {
	const toDomain = emailToDomain(toEmail);
	const isSharedInbox = normalizeDomain(toEmail) === SHARED_INBOX;

	if (isSharedInbox) {
		const recipientDomains = parseRecipientDomains(recipient);
		if (recipientDomains.length > 0) {
			return recipientDomains;
		}
		// 回退到 toEmail 的域名（vpass.cc）
		return toDomain ? [toDomain] : [];
	}

	return toDomain ? [toDomain] : [];
}

const domainFilterUtils = {
	SHARED_INBOX,
	ALL_EMAIL_DOMAINS_SQL,
	normalizeDomain,
	emailToDomain,
	parseRecipientDomains,
	displayToEmail,
	classifyDomains
};

export default domainFilterUtils;
