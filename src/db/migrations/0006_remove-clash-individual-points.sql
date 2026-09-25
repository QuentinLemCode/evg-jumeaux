DELETE FROM `point_events`
WHERE `match_id` IN (
	SELECT m.`id`
	FROM `matches` m
	JOIN `games` g ON m.`game_id` = g.`id`
	WHERE g.`mode` = 'clash'
);
