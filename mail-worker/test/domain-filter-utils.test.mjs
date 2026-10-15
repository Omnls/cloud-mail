import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import domainFilterUtils, { ALL_EMAIL_DOMAINS_SQL } from '../src/utils/domain-filter-utils.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const firstSample = {
	toEmail: 'iantigravitys-gmail@vpass.cc',
	recipient: '[{"address":"iantigravitys@gmail.com","name":""}]'
};
const sharedInboxSample = {
	toEmail: 'inbox@vpass.cc',
	recipient: '[{"address":"w6930504@gmail.com","name":""}]'
};

test('只有统一 inbox 入口解析 recipient', () => {
	assert.deepEqual(domainFilterUtils.classifyDomains(sharedInboxSample), ['gmail.com']);
	assert.deepEqual(domainFilterUtils.classifyDomains(firstSample), ['vpass.cc']);
	assert.deepEqual(domainFilterUtils.classifyDomains({
		toEmail: 'direct@example.com',
		recipient: '[{"address":"copied@gmail.com"}]'
	}), ['example.com']);
});

test('统一入口的 recipient 无效时回退 toEmail，混合脏元素不报错', () => {
	assert.deepEqual(domainFilterUtils.classifyDomains({ toEmail: 'inbox@vpass.cc', recipient: 'bad json' }), ['vpass.cc']);
	assert.deepEqual(domainFilterUtils.classifyDomains({
		toEmail: 'INBOX@VPASS.CC',
		recipient: '["dirty",null,3,{"address":" User@GMail.COM "}]'
	}), ['gmail.com']);
});

test('管理端展示统一入口的原始收件地址并安全回退', () => {
	assert.equal(domainFilterUtils.displayToEmail(sharedInboxSample), 'w6930504@gmail.com');
	assert.equal(domainFilterUtils.displayToEmail({
		toEmail: 'INBOX@VPASS.CC',
		recipient: '[null,{"address":" User@GMail.COM "}]'
	}), 'User@GMail.COM');
	assert.equal(domainFilterUtils.displayToEmail({
		toEmail: 'inbox@vpass.cc',
		recipient: 'bad json'
	}), 'inbox@vpass.cc');
	assert.equal(domainFilterUtils.displayToEmail(firstSample), 'iantigravitys-gmail@vpass.cc');
});

test('域名汇总 SQL 遵守统一入口规则并容忍脏 JSON', () => {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE email (to_email TEXT NOT NULL, recipient TEXT)');
	const insert = db.prepare('INSERT INTO email (to_email, recipient) VALUES (?, ?)');
	insert.run(sharedInboxSample.toEmail, sharedInboxSample.recipient);
	insert.run(firstSample.toEmail, firstSample.recipient);
	insert.run('direct@example.com', '[{"address":"copied@gmail.com"}]');
	insert.run('inbox@vpass.cc', 'bad json');
	insert.run('inbox@vpass.cc', '["dirty",null,3,{"address":"User@QQ.COM"}]');

	const domains = db.prepare(ALL_EMAIL_DOMAINS_SQL).all().map(row => row.domain);
	assert.deepEqual(domains, ['example.com', 'gmail.com', 'qq.com', 'vpass.cc']);
	db.close();
});

test('latest 查询条件在 allList 作用域内声明', () => {
	const servicePath = fileURLToPath(new URL('../src/service/email-service.js', import.meta.url));
	const source = readFileSync(servicePath, 'utf8');
	const filtersEnd = source.indexOf('async delete(c, params, userId)');
	const allListStart = source.indexOf('async allList(c, params)');
	const latestQuery = source.indexOf('const latestEmailQuery', allListStart);

	assert.ok(filtersEnd > 0 && allListStart > filtersEnd && latestQuery > allListStart);
	assert.equal(source.slice(0, filtersEnd).includes('const latestConditions'), false);
	assert.equal(source.slice(allListStart, latestQuery).includes('const latestConditions'), true);
});

test('公共取信按原始地址匹配统一 inbox，同时保持原 toEmail 查询', () => {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE email (email_id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, recipient TEXT)');
	const insert = db.prepare('INSERT INTO email (email_id, to_email, recipient) VALUES (?, ?, ?)');
	insert.run(1, sharedInboxSample.toEmail, sharedInboxSample.recipient);
	insert.run(2, firstSample.toEmail, firstSample.recipient);
	insert.run(3, 'inbox@vpass.cc', 'bad json');
	insert.run(4, 'inbox@vpass.cc', '["dirty",null,{"address":"Second@GMAIL.com"}]');

	const lookupSql = `SELECT email_id FROM email
		WHERE to_email COLLATE NOCASE LIKE ?
			OR (lower(trim(to_email)) = ? AND EXISTS (
				SELECT 1 FROM json_each(CASE
					WHEN json_valid(recipient) AND json_type(recipient) = 'array' THEN recipient
					ELSE '[]'
				END) AS recipient_item
				WHERE trim(CASE
					WHEN recipient_item.type = 'object' THEN json_extract(recipient_item.value, '$.address')
					ELSE NULL
				END) COLLATE NOCASE = trim(?)
			))
		ORDER BY email_id`;
	const lookup = value => db.prepare(lookupSql).all(value, domainFilterUtils.SHARED_INBOX, value).map(row => row.email_id);

	assert.deepEqual(lookup('w6930504@gmail.com'), [1]);
	assert.deepEqual(lookup('SECOND@gmail.COM'), [4]);
	assert.deepEqual(lookup('iantigravitys-gmail@vpass.cc'), [2]);
	assert.deepEqual(lookup('inbox@vpass.cc'), [1, 3, 4]);
	db.close();
});

test('公共取信实现使用统一入口 recipient 精确匹配', () => {
	const servicePath = fileURLToPath(new URL('../src/service/public-service.js', import.meta.url));
	const source = readFileSync(servicePath, 'utf8');

	assert.equal(source.includes('SHARED_INBOX'), true);
	assert.equal(source.includes('json_each(${guardedRecipient})'), true);
	assert.equal(source.includes('trim(${recipientAddress}) COLLATE NOCASE ='), true);
});

test('管理端邮箱搜索匹配统一 inbox 的原始收件地址并去除前导空格', () => {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE email (email_id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, send_email TEXT, recipient TEXT)');
	const insert = db.prepare('INSERT INTO email (email_id, to_email, send_email, recipient) VALUES (?, ?, ?, ?)');
	insert.run(113, 'inbox@vpass.cc', 'noreply@caiaiu.com', '[{"address":"w6930504@gmail.com"}]');
	insert.run(114, 'direct@vpass.cc', 'sender@example.com', '[{"address":"w6930504@gmail.com"}]');
	insert.run(115, 'inbox@vpass.cc', 'sender@example.com', 'bad json');

	const lookupSql = `SELECT email_id FROM email
		WHERE to_email COLLATE NOCASE LIKE ?
			OR send_email COLLATE NOCASE LIKE ?
			OR (lower(trim(to_email)) = ? AND EXISTS (
				SELECT 1 FROM json_each(CASE
					WHEN json_valid(recipient) AND json_type(recipient) = 'array' THEN recipient
					ELSE '[]'
				END) AS recipient_item
				WHERE trim(CASE
					WHEN recipient_item.type = 'object' THEN json_extract(recipient_item.value, '$.address')
					ELSE NULL
				END) COLLATE NOCASE LIKE ?
			))
		ORDER BY email_id`;
	const lookup = value => {
		const search = value.trim() + '%';
		return db.prepare(lookupSql).all(search, search, domainFilterUtils.SHARED_INBOX, search).map(row => row.email_id);
	};

	assert.deepEqual(lookup(' w6930504@gmail.com'), [113]);
	assert.deepEqual(lookup('W6930504@GMAIL.COM'), [113]);
	assert.deepEqual(lookup('direct@vpass.cc'), [114]);
	db.close();

	const servicePath = fileURLToPath(new URL('../src/service/email-service.js', import.meta.url));
	const source = readFileSync(servicePath, 'utf8');
	assert.equal(source.includes('const searchEmail = String(accountEmail).trim()'), true);
	assert.equal(source.includes('trim(${recipientAddress}) COLLATE NOCASE LIKE'), true);
});
