<?php if (isset($_GET['embed'])): ?>
    <?php if (isset($scripts_supplementaires)) echo $scripts_supplementaires; ?>
    </div><!-- /.embed-fragment -->
<?php else: ?>
            </div><!-- /.page-content -->
        </main>
    </div><!-- /.app-layout -->

    <script src="<?= e(get_base_url()) ?>/assets/js/app.js"></script>

    <?php if (isset($scripts_supplementaires)): ?>
        <?= $scripts_supplementaires ?>
    <?php endif; ?>
</body>
</html>
<?php endif; ?>
